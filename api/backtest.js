const { and, gte, lte } = require('drizzle-orm');
const { db } = require('../lib/db');
const { raceHistory } = require('../lib/db/schema');
const { analyzeRace, normalizeName } = require('../scoring');

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function identity(horse) {
  if (horse.horseNumber != null && Number.isFinite(Number(horse.horseNumber))) return `number:${Number(horse.horseNumber)}`;
  return `name:${normalizeName(horse.name)}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const oldest = new Date();
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 2);
  const from = req.query.from || oldest.toISOString().slice(0, 10);
  const to = req.query.to || today;
  if (!validDate(from) || !validDate(to) || from > to || from < oldest.toISOString().slice(0, 10) || to > today) {
    return res.status(400).json({ error: 'Use a valid date range within the last two years.' });
  }

  try {
    const rows = await db.select().from(raceHistory)
      .where(and(gte(raceHistory.raceDate, from), lte(raceHistory.raceDate, to)))
      .orderBy(raceHistory.raceDate, raceHistory.city, raceHistory.raceNo);
    const bySurface = new Map();
    const byRaceType = new Map();
    let evaluatedRaces = 0;
    let omittedRaces = 0;
    let topThreeHitRaces = 0;
    let totalTopThreeHits = 0;
    let winnerHits = 0;

    for (const row of rows) {
      const program = row.program || {};
      const results = row.results || {};
      const horses = Array.isArray(program.runners) ? program.runners : [];
      const finishers = Array.isArray(results.runners) ? results.runners : [];
      if (horses.length < 2 || finishers.length < 1) {
        omittedRaces += 1;
        continue;
      }

      const finishById = new Map(finishers.map((horse) => [identity(horse), Number(horse.finishPosition)]).filter(([, place]) => Number.isFinite(place) && place > 0));
      const scores = analyzeRace({ distance: Number(program.distance) || 1400, horses });
      const matched = scores.map((horse) => ({ horse, place: finishById.get(identity(horse)) })).filter((entry) => Number.isFinite(entry.place));
      if (!matched.length) {
        omittedRaces += 1;
        continue;
      }

      evaluatedRaces += 1;
      const selected = matched.slice(0, 3);
      const hits = selected.filter((entry) => entry.place <= 3).length;
      totalTopThreeHits += hits;
      if (hits > 0) topThreeHitRaces += 1;
      if (matched[0].place === 1) winnerHits += 1;

      const surface = String(program.surface || 'Belirtilmedi');
      const group = bySurface.get(surface) || { races: 0, topThreeHitRaces: 0, totalTopThreeHits: 0, winnerHits: 0 };
      group.races += 1;
      group.topThreeHitRaces += hits > 0 ? 1 : 0;
      group.totalTopThreeHits += hits;
      group.winnerHits += matched[0].place === 1 ? 1 : 0;
      bySurface.set(surface, group);

      const raceType = String(program.raceCategory || program.raceType || 'Tür belirtilmedi');
      const typeGroup = byRaceType.get(raceType) || { races: 0, topThreeHitRaces: 0, totalTopThreeHits: 0, winnerHits: 0 };
      typeGroup.races += 1;
      typeGroup.topThreeHitRaces += hits > 0 ? 1 : 0;
      typeGroup.totalTopThreeHits += hits;
      typeGroup.winnerHits += matched[0].place === 1 ? 1 : 0;
      byRaceType.set(raceType, typeGroup);
    }

    const rate = (value, total) => total ? Number((value / total * 100).toFixed(1)) : null;
    return res.status(200).json({
      model: 'deterministic-baseline-v1',
      from,
      to,
      storedRaces: rows.length,
      evaluatedRaces,
      omittedRaces,
      topThreeHitRaceRate: rate(topThreeHitRaces, evaluatedRaces),
      averageTopThreeHits: evaluatedRaces ? Number((totalTopThreeHits / evaluatedRaces).toFixed(2)) : null,
      winnerHitRate: rate(winnerHits, evaluatedRaces),
      bySurface: Array.from(bySurface, ([surface, group]) => ({
        surface,
        races: group.races,
        topThreeHitRaceRate: rate(group.topThreeHitRaces, group.races),
        averageTopThreeHits: Number((group.totalTopThreeHits / group.races).toFixed(2)),
        winnerHitRate: rate(group.winnerHits, group.races)
      })),
      byRaceType: Array.from(byRaceType, ([raceType, group]) => ({
        raceType,
        races: group.races,
        topThreeHitRaceRate: rate(group.topThreeHitRaces, group.races),
        averageTopThreeHits: Number((group.totalTopThreeHits / group.races).toFixed(2)),
        winnerHitRate: rate(group.winnerHits, group.races)
      })),
      method: 'Test yalnızca yarış programı verilerini ve sabit varsayılan pedigri profilini kullanır. Sonuçlar ölçüm içindir; tarayıcıdaki özel profiller kullanılmaz, puan ağırlıkları güncellenmez.'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return res.status(500).json({ error: message });
  }
};
