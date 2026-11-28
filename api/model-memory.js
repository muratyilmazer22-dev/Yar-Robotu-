const { desc, eq, sql } = require('drizzle-orm');
const { raceHistory, robotMemory, modelTrainingRuns } = require('../lib/db/schema');
const { MODEL_KEY, MODEL_VERSION } = require('../lib/model-version');

function createModelMemoryHandler({ database } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    try {
      const activeDatabase = database || require('../lib/db').db;
      const [archive] = await activeDatabase.select({
        raceCount: sql`count(*)::int`,
        completedRaceCount: sql`count(*) FILTER (WHERE CASE WHEN jsonb_typeof(${raceHistory.results}->'runners') = 'array' THEN jsonb_array_length(${raceHistory.results}->'runners') > 0 ELSE false END)::int`,
        distinctRaceDays: sql`count(DISTINCT ${raceHistory.raceDate})::int`,
        firstDate: sql`min(${raceHistory.raceDate})`,
        lastDate: sql`max(${raceHistory.raceDate})`
      }).from(raceHistory);
      const [automaticModel] = await activeDatabase.select({ memoryValue: robotMemory.memoryValue }).from(robotMemory).where(eq(robotMemory.memoryKey, MODEL_KEY)).limit(1);
      const trainingRunFields = {
        id: modelTrainingRuns.id,
        modelVersion: modelTrainingRuns.modelVersion,
        trainedAt: modelTrainingRuns.trainedAt,
        sampleCounts: modelTrainingRuns.sampleCounts,
        metrics: modelTrainingRuns.metrics,
        accepted: modelTrainingRuns.accepted
      };
      const [latestTrainingRun] = await activeDatabase.select(trainingRunFields).from(modelTrainingRuns).orderBy(desc(modelTrainingRuns.trainedAt)).limit(1);
      const recentTrainingRuns = await activeDatabase.select(trainingRunFields).from(modelTrainingRuns).where(eq(modelTrainingRuns.modelVersion, MODEL_VERSION)).orderBy(desc(modelTrainingRuns.trainedAt)).limit(5);
      const value = {
        version: 3,
        source: 'official-tjk-archive',
        model: automaticModel?.memoryValue?.model || MODEL_VERSION,
        raceCount: Number(archive.raceCount || 0),
        completedRaceCount: Number(archive.completedRaceCount || 0),
        distinctRaceDays: Number(archive.distinctRaceDays || 0),
        firstDate: archive.firstDate || null,
        lastDate: archive.lastDate || null,
        automaticModel: automaticModel?.memoryValue || null,
        latestTrainingRun: latestTrainingRun || null,
        recentTrainingRuns,
        refreshedAt: new Date().toISOString()
      };

      return res.status(200).json(value);
    } catch {
      return res.status(503).json({ error: 'Shared model memory is temporarily unavailable.' });
    }
  };
}

module.exports = createModelMemoryHandler();
module.exports.createModelMemoryHandler = createModelMemoryHandler;
