const { and, gte, lte } = require('drizzle-orm');
const { db } = require('../lib/db');
const { raceHistory } = require('../lib/db/schema');
const { analyzeEnsemble, normalizeName } = require('../scoring');

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
    const thresholds = [10, 12.5, 15];
    const validationDates = [...new Set(rows.map((row) => String(row.raceDate)))].sort();
    const validationStartIndex = Math.floor(validationDates.length * 0.8);
    const validationStartDate = validationDates.length >= 5 ? validationDates[validationStartIndex] || null : null;
    const thresholdValidation = thresholds.map((threshold) => ({ threshold, candidates: 0, wins: 0 }));
    let validationRaces = 0;
    let validationTop1Hits = 0;
    let evaluatedRaces = 0;
    let omittedRaces = 0;
    let topThreeHitRaces = 0;
    let totalTopThreeHits = 0;
    let winnerHits = 0;
    let marketFavoriteHits = 0;
    let surpriseSignalWinnerHits = 0;
    let validationMarketFavoriteHits = 0;

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
      const scores = analyzeEnsemble({ distance: Number(program.distance) || 1400, surface: program.surface, type: program.raceCategory || program.raceType, horses });
      const matched = scores.map((horse) => ({ horse, place: finishById.get(identity(horse)) })).filter((entry) => Number.isFinite(entry.place));
      const winnerEntry = matched.find((entry) => entry.place === 1);
      if (!winnerEntry) {
        omittedRaces += 1;
        continue;
      }

      evaluatedRaces += 1;
      const selected = scores.slice(0, 3).map((horse) => ({ horse, place: finishById.get(identity(horse)) }));
      const hits = selected.filter((entry) => Number.isFinite(entry.place) && entry.place <= 3).length;
      totalTopThreeHits += hits;
      if (hits > 0) topThreeHitRaces += 1;
      const modelLeaderHit = scores[0]?.number === winnerEntry.horse.number;
      if (modelLeaderHit) winnerHits += 1;
      const marketFavorite = scores.filter((horse) => horse.marketScore !== null).sort((a, b) => b.marketScore - a.marketScore)[0];
      const marketFavoriteHit = Boolean(marketFavorite && marketFavorite.number === winnerEntry.horse.number);
      if (marketFavoriteHit) marketFavoriteHits += 1;
      if (winnerEntry?.horse.signal === 'Sürpriz adayı') surpriseSignalWinnerHits += 1;

      if (validationStartDate && String(row.raceDate) >= validationStartDate) {
        validationRaces += 1;
        if (modelLeaderHit) validationTop1Hits += 1;
        if (marketFavoriteHit) validationMarketFavoriteHits += 1;
        const gap = scores.length > 1 ? scores[0].score - scores[1].score : 0;
        if ((scores[0]?.independentCoverage || 0) >= 50) {
          for (const result of thresholdValidation) {
            if (gap >= result.threshold) {
              result.candidates += 1;
              if (matched.find((entry) => entry.horse.number === scores[0].number)?.place === 1) result.wins += 1;
            }
          }
        }
      }

      const surface = String(program.surface || 'Belirtilmedi');
      const group = bySurface.get(surface) || { races: 0, topThreeHitRaces: 0, totalTopThreeHits: 0, winnerHits: 0 };
      group.races += 1;
      group.topThreeHitRaces += hits > 0 ? 1 : 0;
      group.totalTopThreeHits += hits;
      group.winnerHits += modelLeaderHit ? 1 : 0;
      bySurface.set(surface, group);

      const raceType = String(program.raceCategory || program.raceType || 'Tür belirtilmedi');
      const typeGroup = byRaceType.get(raceType) || { races: 0, topThreeHitRaces: 0, totalTopThreeHits: 0, winnerHits: 0 };
      typeGroup.races += 1;
      typeGroup.topThreeHitRaces += hits > 0 ? 1 : 0;
      typeGroup.totalTopThreeHits += hits;
      typeGroup.winnerHits += modelLeaderHit ? 1 : 0;
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
      marketFavoriteHitRate: rate(marketFavoriteHits, evaluatedRaces),
      surpriseSignalWinnerRate: rate(surpriseSignalWinnerHits, evaluatedRaces),
      validation: {
        from: validationStartDate,
        to: validationDates.at(-1) || null,
        races: validationRaces,
        baselineTop1HitRate: rate(validationTop1Hits, validationRaces),
        marketFavoriteHitRate: rate(validationMarketFavoriteHits, validationRaces),
        minimumUsefulCandidates: 30,
        thresholds: thresholdValidation.map((item) => ({
          scoreGap: item.threshold,
          independentCoverageMinimum: 50,
          candidates: item.candidates,
          wins: item.wins,
          winRate: rate(item.wins, item.candidates),
          enoughCandidates: item.candidates >= 30,
          validated: item.candidates >= 30 && validationRaces > 0 && item.wins / item.candidates > validationTop1Hits / validationRaces
        }))
      },
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
      method: 'Bu rapor uygulamadaki ortak sekiz stratejili puanlama motorunun varsayılan ağırlıklarını kullanır. Son tarihlerden ayrılan %20 bölüm eşik karşılaştırması için tutulur; kullanıcıya özel profiller/öğrenilmiş ağırlıklar ve kupon ödeme verileri bu sunucu testinde yer almaz. 30’dan az eşik adayı sonuçları yön gösterici sayılmamalıdır. Sonuçlar kazanma garantisi değildir.'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return res.status(500).json({ error: message });
  }
};
