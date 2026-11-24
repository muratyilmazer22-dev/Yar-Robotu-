const { and, eq, gte, lte } = require('drizzle-orm');
const { db } = require('../lib/db');
const { raceHistory, robotMemory } = require('../lib/db/schema');
const { analyzeRace, normalizeName, BASE_WEIGHTS, softmaxScores } = require('../scoring');
const classHistory = require('../class-history');
const raceContext = require('../lib/race-context');
const pedigreeHistory = require('../lib/pedigree-history');
const raceRelations = require('../lib/race-relations');
const { getWinnerRank, getWinnerRankBucket } = require('../lib/backtest-metrics');
const { createReturnMetrics, recordReturn, finalizeReturnMetrics } = require('../lib/backtest-economics');

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
  oldest.setUTCDate(oldest.getUTCDate() - 365);
  const from = req.query.from || oldest.toISOString().slice(0, 10);
  const to = req.query.to || today;
  if (!validDate(from) || !validDate(to) || from > to || from < oldest.toISOString().slice(0, 10) || to > today) {
    return res.status(400).json({ error: 'Use a valid date range within the latest 365 days.' });
  }

  try {
    const rows = await db.select().from(raceHistory)
      .where(and(gte(raceHistory.raceDate, from), lte(raceHistory.raceDate, to)))
      .orderBy(raceHistory.raceDate, raceHistory.city, raceHistory.raceNo);
    const [storedAutomaticModel] = await db.select({ memoryValue: robotMemory.memoryValue }).from(robotMemory).where(eq(robotMemory.memoryKey, 'automatic-learning-model')).limit(1);
    const automaticModel = storedAutomaticModel?.memoryValue || null;
    const acceptedValidation = automaticModel?.lastAcceptedValidation || null;
    const automaticWeights = automaticModel?.weights;
    const hasValidatedAutomaticModel = Boolean(
      acceptedValidation?.from
      && automaticWeights
      && Object.keys(BASE_WEIGHTS).every((key) => Number.isFinite(Number(automaticWeights[key])))
    );
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
    let randomPickRateTotal = 0;
    let winnerTopThreeRankHits = 0;
    const winnerRankCounts = { "1": 0, "2–3": 0, "4–6": 0, "7+": 0 };
    let totalWinnerRank = 0;
    let marketFavoriteHits = 0;
    let surpriseCandidateRaces = 0;
    let surpriseCandidateWinnerHits = 0;
    let validationMarketFavoriteHits = 0;
    let automaticValidationRaces = 0;
    let automaticModelTop1Hits = 0;
    let automaticMarketFavoriteHits = 0;
    let automaticBaselineBrierTotal = 0;
    let automaticLearnedBrierTotal = 0;
    const returnMetrics = { fixed: createReturnMetrics(), favorite: createReturnMetrics(), automatic: createReturnMetrics() };
    const contextIndex = raceContext.createIndex(rows);
    const classIndex = classHistory.createIndex(rows);
    const pedigreeIndex = pedigreeHistory.createIndex(rows);
    const relationIndex = raceRelations.createIndex(rows);

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
      const raceDate = String(row.raceDate || '').slice(0, 10);
      const scoringHorses = horses.map((horse) => ({
        ...horse,
        odds: null,
        ...raceContext.scoreForHorse(contextIndex, horse.name, {
          city: row.city,
          weather: program.weather,
          surface: program.surface,
          trackCondition: program.trackCondition,
          surfaceChange: program.surfaceChange,
          distance: program.distance,
          jockey: horse.jockey,
          weight: horse.weight
        }, raceDate),
        classHistoryScore: classHistory.scoreForHorse(classIndex, horse.name, program.raceType || program.raceCategory || program.title || '', raceDate),
        groupFit: classHistory.groupFitForHorse(classIndex, horse.name, raceDate),
        pedigreeFit: pedigreeHistory.scoreForHorse(pedigreeIndex, horse, { surface: program.surface, distance: program.distance }, raceDate),
        rivalFit: raceRelations.scoreAgainstField({ horses: horses.filter((runner) => !runner.scratched) }, horse, relationIndex, raceDate)
      }));
      const scoringRace = {
        distance: Number(program.distance) || 1400,
        surface: program.surface,
        type: program.raceCategory || program.raceType,
        city: row.city,
        horses: scoringHorses
      };
      const scores = analyzeRace(scoringRace);
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
      const winnerRank = getWinnerRank(scores, winnerEntry.horse.number);
      const winnerRankBucket = getWinnerRankBucket(winnerRank);
      if (winnerRankBucket) {
        winnerRankCounts[winnerRankBucket] += 1;
        totalWinnerRank += winnerRank;
        if (winnerRank <= 3) winnerTopThreeRankHits += 1;
      }
      const modelLeaderHit = winnerRank === 1;
      if (modelLeaderHit) winnerHits += 1;
      randomPickRateTotal += 1 / Math.max(1, scores.length);
      const marketFavorite = scores.filter((horse) => horse.marketScore !== null).sort((a, b) => b.marketScore - a.marketScore)[0];
      const marketFavoriteHit = Boolean(marketFavorite && marketFavorite.number === winnerEntry.horse.number);
      if (marketFavoriteHit) marketFavoriteHits += 1;
      const winningOdds = Number(finishers.find((horse) => identity(horse) === identity(winnerEntry.horse))?.odds);
      recordReturn(returnMetrics.fixed, scores[0], winnerEntry.horse.number, winningOdds);
      recordReturn(returnMetrics.favorite, marketFavorite, winnerEntry.horse.number, winningOdds);
      const surpriseCandidates = scores.filter((horse) => horse.signal === 'Sürpriz adayı');
      if (surpriseCandidates.length) {
        surpriseCandidateRaces += 1;
        if (surpriseCandidates.some((horse) => Number(horse.number) === Number(winnerEntry.horse.number))) surpriseCandidateWinnerHits += 1;
      }

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

      if (hasValidatedAutomaticModel && raceDate >= acceptedValidation.from) {
        const eligibleContextWeights = Object.fromEntries(Object.entries(automaticModel.contextWeights || {}).filter(([key, weights]) => {
          const contextReport = automaticModel.contextReports?.[key];
          return contextReport?.updated && contextReport.validationStartDate && raceDate >= contextReport.validationStartDate
            && Object.keys(BASE_WEIGHTS).every((name) => Number.isFinite(Number(weights?.[name])));
        }));
        const learnedScores = analyzeRace(scoringRace, {
          modelWeights: automaticWeights,
          contextWeights: eligibleContextWeights
        });
        const learnedWinnerRank = getWinnerRank(learnedScores, winnerEntry.horse.number);
        const learnedFavorite = learnedScores.filter((horse) => horse.marketScore !== null).sort((a, b) => b.marketScore - a.marketScore)[0];
        if (learnedWinnerRank === 1) automaticModelTop1Hits += 1;
        if (learnedFavorite?.number === winnerEntry.horse.number) automaticMarketFavoriteHits += 1;
        recordReturn(returnMetrics.automatic, learnedScores[0], winnerEntry.horse.number, winningOdds);
        const baselineProbabilities = softmaxScores(scores, BASE_WEIGHTS);
        const learnedProbabilities = softmaxScores(learnedScores, automaticWeights);
        automaticBaselineBrierTotal += baselineProbabilities.reduce((total, probability, index) => total + (probability - Number(scores[index].number === winnerEntry.horse.number)) ** 2, 0);
        automaticLearnedBrierTotal += learnedProbabilities.reduce((total, probability, index) => total + (probability - Number(learnedScores[index].number === winnerEntry.horse.number)) ** 2, 0);
        automaticValidationRaces += 1;
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
      randomPickHitRate: evaluatedRaces ? Number((randomPickRateTotal / evaluatedRaces * 100).toFixed(1)) : null,
      winnerTopThreeRankRate: rate(winnerTopThreeRankHits, evaluatedRaces),
      averageWinnerRank: evaluatedRaces ? Number((totalWinnerRank / evaluatedRaces).toFixed(2)) : null,
      winnerRankCounts,
      marketFavoriteHitRate: rate(marketFavoriteHits, evaluatedRaces),
      returnMetrics: {
        fixed: finalizeReturnMetrics(returnMetrics.fixed),
        favorite: finalizeReturnMetrics(returnMetrics.favorite),
        automatic: finalizeReturnMetrics(returnMetrics.automatic),
        basis: 'Birim bahis; yalnızca kazanan at için pozitif TJK ganyan oranı bulunan koşular ROI paydasına alınır. Bu simülasyon kupon getirisi veya gelecek performans garantisi değildir.'
      },
      surpriseCandidateHitRate: rate(surpriseCandidateWinnerHits, surpriseCandidateRaces),
      surpriseCandidateRaces,
      surpriseCandidateWinnerHits,
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
      automaticModelValidation: {
        available: hasValidatedAutomaticModel,
        reason: hasValidatedAutomaticModel ? null : 'Ortak hafızada ileri-tarih doğrulaması bulunan öğrenilmiş ağırlık yok.',
        model: hasValidatedAutomaticModel ? automaticModel.model : null,
        from: acceptedValidation?.from || null,
        to: acceptedValidation?.to || null,
        races: automaticValidationRaces,
        modelTop1HitRate: rate(automaticModelTop1Hits, automaticValidationRaces),
        marketFavoriteHitRate: rate(automaticMarketFavoriteHits, automaticValidationRaces),
        baselineBrier: automaticValidationRaces ? Number((automaticBaselineBrierTotal / automaticValidationRaces).toFixed(4)) : null,
        learnedBrier: automaticValidationRaces ? Number((automaticLearnedBrierTotal / automaticValidationRaces).toFixed(4)) : null,
        trainingReport: automaticModel?.report || null,
        finalHoldout: automaticModel?.holdoutEvaluation || null,
        holdoutFrom: automaticModel?.report?.holdoutStartDate || null,
        holdoutTo: automaticModel?.report?.holdoutTo || null,
        contextModelCount: Object.keys(automaticModel?.contextWeights || {}).length,
        refreshedAt: automaticModel?.refreshedAt || null
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
      method: 'Ana rapor sabit temel ağırlıklarla form, piyasa, HP, pedigri, grup seviyesi/bitiriş, sınıf geçmişi, hipodrom, hava, pist ve derece sinyallerini değerlendirir. Ayrı otomatik-model karşılaştırması yalnızca modelin eğitiminde kullanılmamış, kabul edilmiş ileri tarih doğrulama aralığını kullanır. Tüm arşiv indeksleri hedef tarihten önceki yarışlarla sınırlandırılır. 30’dan az eşik adayı sonuçları yön gösterici sayılmamalıdır. Sonuçlar kazanma garantisi değildir.'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    return res.status(500).json({ error: message });
  }
};
