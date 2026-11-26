const { createHash } = require('node:crypto');
const { db: defaultDb } = require('../lib/db');
const { shadowRaceSignals } = require('../lib/db/schema');
const { verifyFirebaseIdToken: defaultVerifyToken } = require('../lib/history-import-security');
const { cleanSignals, raceKey } = require('../lib/shadow-signal-learning');

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function createShadowSignalsHandler({ database = defaultDb, verifyToken = defaultVerifyToken } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    const authorization = req.headers?.authorization || req.headers?.Authorization;
    const idToken = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const ownerId = await verifyToken(idToken);
    if (!ownerId) return res.status(401).json({ error: 'Gölge sinyallerini kaydetmek için oturum açın.' });

    const records = req.body?.records;
    if (!Array.isArray(records) || records.length < 1 || records.length > 30) {
      return res.status(400).json({ error: 'Bir istekte 1–30 koşu sinyali gönderilebilir.' });
    }

    const rows = [];
    for (const record of records) {
      const date = String(record?.raceDate || '');
      const city = String(record?.city || '').trim();
      const raceNo = Number(record?.raceNo);
      const signals = cleanSignals(record?.signals);
      const key = raceKey(date, city, raceNo);
      const publishedAtValue = record?.sourcePublishedAt;
      const publishedAt = typeof publishedAtValue === 'string' && publishedAtValue.length <= 40 ? new Date(publishedAtValue) : null;
      const hasPublishedAt = publishedAt && Number.isFinite(publishedAt.getTime());
      const raceDayStart = isCalendarDate(date) ? new Date(`${date}T00:00:00+03:00`) : null;
      const confirmed = record?.publishedBeforeRace === true && Boolean(hasPublishedAt) && publishedAt < raceDayStart && publishedAt.getTime() <= Date.now();
      if (!key || !isCalendarDate(date) || !city || city.length > 80 || !signals) continue;
      const signalId = createHash('sha256').update(`${ownerId}|${key}`).digest('hex');
      rows.push({
        signalId,
        ownerId,
        raceDate: date,
        city,
        raceNo,
        sourcePublishedAt: hasPublishedAt ? publishedAt : null,
        publishedBeforeRace: confirmed,
        signals,
        sourceNote: ''
      });
    }
    if (!rows.length) return res.status(400).json({ error: 'Tarih, hipodrom, koşu numarası veya yorum sinyali doğrulanamadı.' });

    try {
      for (const row of rows) {
        await database.insert(shadowRaceSignals).values(row).onConflictDoUpdate({
          target: shadowRaceSignals.signalId,
          set: {
            sourcePublishedAt: row.sourcePublishedAt,
            publishedBeforeRace: row.publishedBeforeRace,
            signals: row.signals,
            sourceNote: row.sourceNote
          }
        });
      }
      return res.status(200).json({ saved: rows.length, pending: rows.filter((row) => !row.publishedBeforeRace).length, message: 'Sinyaller hafızaya alındı; yalnızca kullanıcı onaylı ve resmi sonuçla birebir eşleşen kayıtlar doğrulamalı öğrenmeye katılır.' });
    } catch (error) {
      console.error('[shadow-signals] Save failed:', error?.code || 'SHADOW_SIGNAL_SAVE_FAILED');
      return res.status(503).json({ error: 'Gölge sinyalleri şu anda kaydedilemiyor.' });
    }
  };
}

module.exports = createShadowSignalsHandler();
module.exports.createShadowSignalsHandler = createShadowSignalsHandler;
