const { desc, eq, sql } = require('drizzle-orm');
const { raceHistory, raceHistoryAudit } = require('../lib/db/schema');

function createHistoryHandler({ database } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Automatic archive imports are disabled. Add your own bulletin through the app.' });
    }

    try {
      const activeDatabase = database || require('../lib/db').db;
      const [summary] = await activeDatabase.select({
        raceCount: sql`count(*)::int`,
        firstDate: sql`min(${raceHistory.raceDate})`,
        lastDate: sql`max(${raceHistory.raceDate})`
      }).from(raceHistory);
      const recent = await activeDatabase.select({ raceDate: raceHistory.raceDate, city: raceHistory.city, raceNo: raceHistory.raceNo, importedAt: raceHistory.importedAt })
        .from(raceHistory)
        .orderBy(desc(raceHistory.raceDate), desc(raceHistory.raceNo))
        .limit(5);
      const recentQuality = await activeDatabase.select({ raceDate: raceHistoryAudit.raceDate, city: raceHistoryAudit.city, raceNo: raceHistoryAudit.raceNo, details: raceHistoryAudit.details, recordedAt: raceHistoryAudit.recordedAt })
        .from(raceHistoryAudit)
        .where(eq(raceHistoryAudit.eventType, 'import_quality'))
        .orderBy(desc(raceHistoryAudit.recordedAt))
        .limit(5);
      const [qualitySummary] = await activeDatabase.select({
        auditedCount: sql`count(*)::int`,
        needsReview: sql`count(*) FILTER (WHERE ${raceHistoryAudit.details}->'quality'->>'status' = 'needs_review')::int`
      }).from(raceHistoryAudit).where(eq(raceHistoryAudit.eventType, 'import_quality'));
      return res.status(200).json({ ...summary, recent, recentQuality, qualitySummary });
    } catch {
      return res.status(503).json({ error: 'The history archive is temporarily unavailable.' });
    }
  };
}

module.exports = createHistoryHandler();
module.exports.createHistoryHandler = createHistoryHandler;
