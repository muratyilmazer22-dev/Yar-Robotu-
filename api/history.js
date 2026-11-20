const { and, desc, eq, gte, lte, sql } = require('drizzle-orm');
const { db } = require('../lib/db');
const { raceHistory } = require('../lib/db/schema');
const { importTjkDay } = require('../lib/tjk');

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateBounds() {
  const today = new Date();
  const earliest = new Date(today);
  earliest.setUTCFullYear(earliest.getUTCFullYear() - 2);
  return { today: today.toISOString().slice(0, 10), earliest: earliest.toISOString().slice(0, 10) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  try {
    if (req.method === 'GET') {
      const [summary] = await db.select({
        raceCount: sql`count(*)::int`,
        firstDate: sql`min(${raceHistory.raceDate})`,
        lastDate: sql`max(${raceHistory.raceDate})`
      }).from(raceHistory);
      const recent = await db.select({ raceDate: raceHistory.raceDate, city: raceHistory.city, raceNo: raceHistory.raceNo, importedAt: raceHistory.importedAt })
        .from(raceHistory)
        .orderBy(desc(raceHistory.raceDate), desc(raceHistory.raceNo))
        .limit(5);
      return res.status(200).json({ ...summary, recent });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const date = body.date;
    const { today, earliest } = dateBounds();
    if (!isIsoDate(date) || date < earliest || date > today) {
      return res.status(400).json({ error: `Choose one valid TJK date between ${earliest} and ${today}.` });
    }

    const existingDay = await db.select().from(raceHistory).where(eq(raceHistory.raceDate, date));
    const alreadyComplete = existingDay.length > 0 && existingDay.every((row) => row.program?.runners?.length > 0 && row.results?.runners?.length > 0 && row.program?.schemaVersion === 2 && row.program.runners.every((horse) => Object.hasOwn(horse, 'age') && Object.hasOwn(horse, 'handicapPoints') && Object.hasOwn(horse, 'programStartNumber')));
    if (alreadyComplete) {
      return res.status(200).json({ date, savedRaces: existingDay.length, programRaces: existingDay.length, resultRaces: existingDay.length, cities: [...new Set(existingDay.map((row) => row.city))], alreadyComplete: true, warnings: [] });
    }

    const imported = await importTjkDay(date);
    const existing = existingDay;
    const byKey = new Map(existing.map((row) => [`${row.city}:${row.raceNo}`, row]));
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

    await db.insert(raceHistory).values(values).onConflictDoUpdate({
      target: [raceHistory.raceDate, raceHistory.city, raceHistory.raceNo],
      set: {
        program: sql`excluded.program`,
        results: sql`excluded.results`,
        sourceUrls: sql`excluded.source_urls`,
        importedAt: new Date()
      }
    });

    return res.status(200).json({
      date,
      savedRaces: values.length,
      programRaces: values.filter((row) => row.program.runners.length > 0).length,
      resultRaces: values.filter((row) => row.results.runners.length > 0).length,
      cities: imported.cities,
      warnings: imported.errors
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return res.status(502).json({ error: message });
  }
};
