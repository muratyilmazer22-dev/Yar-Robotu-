const { desc, eq, sql } = require('drizzle-orm');
const { db } = require('../lib/db');
const { raceHistory, robotMemory, modelTrainingRuns } = require('../lib/db/schema');
const { MODEL_KEY, MODEL_VERSION } = require('../lib/model-version');

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
    const [automaticModel] = await db.select({ memoryValue: robotMemory.memoryValue }).from(robotMemory).where(eq(robotMemory.memoryKey, MODEL_KEY)).limit(1);
    const recentTrainingRuns = await db.select({
      id: modelTrainingRuns.id,
      modelVersion: modelTrainingRuns.modelVersion,
      trainedAt: modelTrainingRuns.trainedAt,
      sampleCounts: modelTrainingRuns.sampleCounts,
      metrics: modelTrainingRuns.metrics,
      accepted: modelTrainingRuns.accepted
    }).from(modelTrainingRuns).where(eq(modelTrainingRuns.modelVersion, MODEL_VERSION)).orderBy(desc(modelTrainingRuns.trainedAt)).limit(5);
    const value = {
      version: 2,
      source: 'official-tjk-archive+verified-shadow-signals',
      model: automaticModel?.memoryValue?.model || MODEL_VERSION,
      raceCount: Number(archive.raceCount || 0),
      completedRaceCount: Number(archive.completedRaceCount || 0),
      firstDate: archive.firstDate || null,
      lastDate: archive.lastDate || null,
      automaticModel: automaticModel?.memoryValue || null,
      recentTrainingRuns,
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
