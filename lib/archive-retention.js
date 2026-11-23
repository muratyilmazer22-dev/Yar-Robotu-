const { lt } = require('drizzle-orm');
const { raceHistory } = require('./db/schema');

const ARCHIVE_RETENTION_DAYS = 365;

function archiveCutoff(now = new Date()) {
  return new Date(new Date(now).getTime() - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function pruneExpiredArchive(database, now = new Date()) {
  const cutoff = archiveCutoff(now);
  const removed = await database.delete(raceHistory)
    .where(lt(raceHistory.raceDate, cutoff))
    .returning({ raceDate: raceHistory.raceDate });
  return { cutoff, removed: removed.length };
}

module.exports = { ARCHIVE_RETENTION_DAYS, archiveCutoff, pruneExpiredArchive };
