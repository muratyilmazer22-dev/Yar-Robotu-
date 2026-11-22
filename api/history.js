const { desc, eq, sql } = require('drizzle-orm');
const { db, pool } = require('../lib/db');
const { raceHistory } = require('../lib/db/schema');
const { importTjkDay } = require('../lib/tjk');
const { createHistoryRateLimiter, getClientIp, verifyFirebaseIdToken } = require('../lib/history-import-security');

const rateLimit = createHistoryRateLimiter(pool);
const PER_SUBJECT_LIMIT = 900;
const GLOBAL_LIMIT = 5000;

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateBounds() {
  const today = new Date();
  const earliest = new Date(today);
  earliest.setUTCFullYear(earliest.getUTCFullYear() - 2);
  return { today: today.toISOString().slice(0, 10), earliest: earliest.toISOString().slice(0, 10) };
}

function bearerToken(req) {
  const value = req.headers?.authorization;
  const match = typeof value === 'string' && value.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

function createHistoryHandler({ database = db, importDay = importTjkDay, verifyToken = verifyFirebaseIdToken, checkRateLimit = rateLimit } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Authorization');

    try {
      if (req.method === 'GET') {
        const [summary] = await database.select({
          raceCount: sql`count(*)::int`,
          firstDate: sql`min(${raceHistory.raceDate})`,
          lastDate: sql`max(${raceHistory.raceDate})`
        }).from(raceHistory);
        const recent = await database.select({ raceDate: raceHistory.raceDate, city: raceHistory.city, raceNo: raceHistory.raceNo, importedAt: raceHistory.importedAt })
          .from(raceHistory)
          .orderBy(desc(raceHistory.raceDate), desc(raceHistory.raceNo))
          .limit(5);
        return res.status(200).json({ ...summary, recent });
      }

      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'Method not allowed.' });
      }

      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      } catch {
        return res.status(400).json({ error: 'Request body must be valid JSON.' });
      }
      const date = body.date;
      const { today, earliest } = dateBounds();
      if (!isIsoDate(date) || date < earliest || date > today) {
        return res.status(400).json({ error: `Choose one valid TJK date between ${earliest} and ${today}.` });
      }

      const token = bearerToken(req);
      if (!token) return res.status(401).json({ error: 'Sign in to import TJK history.' });

      const ip = getClientIp(req);
      const ipRetryAfter = await checkRateLimit(`ip:${ip}`, PER_SUBJECT_LIMIT);
      if (ipRetryAfter) {
        res.setHeader('Retry-After', String(ipRetryAfter));
        return res.status(429).json({ error: 'Too many history import requests. Try again later.' });
      }

      const userId = await verifyToken(token);
      if (!userId) return res.status(401).json({ error: 'Your session is invalid or expired. Sign in again.' });

      const userRetryAfter = await checkRateLimit(`user:${userId}`, PER_SUBJECT_LIMIT);
      const globalRetryAfter = userRetryAfter ? 0 : await checkRateLimit('global', GLOBAL_LIMIT);
      const retryAfter = userRetryAfter || globalRetryAfter;
      if (retryAfter) {
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ error: 'Too many history import requests. Try again later.' });
      }

      const existingDay = await database.select().from(raceHistory).where(eq(raceHistory.raceDate, date));
      const alreadyComplete = existingDay.length > 0 && existingDay.every((row) => row.program?.runners?.length > 0 && row.results?.runners?.length > 0 && row.program?.schemaVersion === 2 && row.program.runners.every((horse) => Object.hasOwn(horse, 'age') && Object.hasOwn(horse, 'handicapPoints') && Object.hasOwn(horse, 'programStartNumber')));
      if (alreadyComplete) {
        return res.status(200).json({ date, savedRaces: 0, existingRaces: existingDay.length, programRaces: existingDay.length, resultRaces: existingDay.length, cities: [...new Set(existingDay.map((row) => row.city))], alreadyComplete: true, warnings: [] });
      }

      const imported = await importDay(date);
      const byKey = new Map(existingDay.map((row) => [`${row.city}:${row.raceNo}`, row]));
      const values = imported.records.map((record) => {
        const previous = byKey.get(`${record.city}:${record.raceNo}`);
        const program = record.program.runners.length ? record.program : previous?.program || record.program;
        const results = record.results.runners.length ? record.results : previous?.results || record.results;
        return {
          raceDate: date,
          city: record.city,
          raceNo: record.raceNo,
          program,
          results,
          sourceUrls: { ...(previous?.sourceUrls || {}), ...record.sourceUrls },
          importedAt: new Date()
        };
      });

      if (values.length) {
        await database.insert(raceHistory).values(values).onConflictDoUpdate({
          target: [raceHistory.raceDate, raceHistory.city, raceHistory.raceNo],
          set: {
            program: sql`excluded.program`,
            results: sql`excluded.results`,
            sourceUrls: sql`excluded.source_urls`,
            importedAt: new Date()
          }
        });
      }

      return res.status(200).json({
        date,
        savedRaces: values.length,
        programRaces: values.filter((row) => row.program.runners.length > 0).length,
        resultRaces: values.filter((row) => row.results.runners.length > 0).length,
        cities: imported.cities,
        warnings: imported.errors
      });
    } catch {
      return res.status(502).json({ error: 'The history request could not be completed. Please try again later.' });
    }
  };
}

module.exports = createHistoryHandler();
module.exports.createHistoryHandler = createHistoryHandler;
