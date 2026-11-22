const { sql } = require('drizzle-orm');
const { db } = require('../lib/db');
const { raceHistory, robotMemory } = require('../lib/db/schema');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const [archive] = await db.select({
      raceCount: sql`count(*)::int`,
      completedRaceCount: sql`count(*) FILTER (WHERE CASE WHEN jsonb_typeof(${raceHistory.results}->'runners') = 'array' THEN jsonb_array_length(${raceHistory.results}->'runners') > 0 ELSE false END)::int`,
      firstDate: sql`min(${raceHistory.raceDate})`,
      lastDate: sql`max(${raceHistory.raceDate})`
    }).from(raceHistory);
    const value = {
      version: 1,
      source: 'official-tjk-archive',
      model: 'deterministic-analysis-v3',
      raceCount: Number(archive.raceCount || 0),
      completedRaceCount: Number(archive.completedRaceCount || 0),
      firstDate: archive.firstDate || null,
      lastDate: archive.lastDate || null,
      refreshedAt: new Date().toISOString()
    };

    await db.insert(robotMemory).values({ memoryKey: 'official-tjk-archive', memoryValue: value, updatedAt: new Date() }).onConflictDoUpdate({
      target: robotMemory.memoryKey,
      set: { memoryValue: value, updatedAt: new Date() }
    });

    return res.status(200).json(value);
  } catch {
    return res.status(503).json({ error: 'Shared model memory is temporarily unavailable.' });
  }
};
