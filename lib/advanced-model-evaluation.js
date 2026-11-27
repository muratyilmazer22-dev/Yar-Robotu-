const { BASE_WEIGHTS, MINIMUM_TRAINING_DATES, fitModel } = require('./automatic-learning');
const { summarizeWinnerRankContexts } = require('./backtest-metrics');
const { softmaxScores } = require('../scoring');

const MINIMUM_EVIDENCE_FOLDS = 5;
const MAXIMUM_WALK_FORWARD_FOLDS = 12;
const MINIMUM_BLEND_CALIBRATION_RACES = 20;
const CALIBRATION_BIN_COUNT = 10;
const PROBABILITY_FLOOR = 1e-15;

function normalizeProbabilities(probabilities) {
  if (!Array.isArray(probabilities) || probabilities.length < 2) return null;
  if (probabilities.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  return probabilities.map((value) => value / total);
}

function marketProbabilities(horses) {
  if (!Array.isArray(horses) || horses.length < 2) return null;
  const shares = horses.map((horse) => horse.agf);
  if (shares.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return normalizeProbabilities(shares);
}

function summarizeProbabilities(races, strategy) {
  let scoredRaces = 0;
  let brierTotal = 0;
  let logLossTotal = 0;
  let topOneHits = 0;
  const bins = Array.from({ length: CALIBRATION_BIN_COUNT }, (_, index) => ({
    lower: index / CALIBRATION_BIN_COUNT,
    upper: (index + 1) / CALIBRATION_BIN_COUNT,
    count: 0,
    predictedTotal: 0,
    observedTotal: 0
  }));

  for (const race of races) {
    const probabilities = normalizeProbabilities(race[strategy]);
    const winnerIndex = race.horses.findIndex((horse) => Number(horse.number) === Number(race.winner));
    if (!probabilities || probabilities.length !== race.horses.length || winnerIndex < 0) continue;

    scoredRaces += 1;
    const winnerProbability = Math.max(PROBABILITY_FLOOR, probabilities[winnerIndex]);
    logLossTotal -= Math.log(winnerProbability);
    brierTotal += probabilities.reduce((sum, probability, index) => sum + (probability - Number(index === winnerIndex)) ** 2, 0);
    const leaderIndex = probabilities.indexOf(Math.max(...probabilities));
    topOneHits += Number(leaderIndex === winnerIndex);

    probabilities.forEach((probability, index) => {
      const binIndex = Math.min(CALIBRATION_BIN_COUNT - 1, Math.floor(probability * CALIBRATION_BIN_COUNT));
      const bin = bins[binIndex];
      bin.count += 1;
      bin.predictedTotal += probability;
      bin.observedTotal += Number(index === winnerIndex);
    });
  }

  const calibration = bins.filter((bin) => bin.count > 0).map((bin) => ({
    lower: bin.lower,
    upper: bin.upper,
    count: bin.count,
    meanPredicted: bin.predictedTotal / bin.count,
    observedRate: bin.observedTotal / bin.count
  }));
  const calibrationError = scoredRaces
    ? bins.reduce((total, bin) => total + (bin.count ? bin.count * Math.abs(bin.predictedTotal / bin.count - bin.observedTotal / bin.count) : 0), 0)
      / bins.reduce((total, bin) => total + bin.count, 0)
    : null;

  return {
    races: scoredRaces,
    topOneHits,
    topOneHitRate: scoredRaces ? topOneHits / scoredRaces : null,
    brier: scoredRaces ? brierTotal / scoredRaces : null,
    logLoss: scoredRaces ? logLossTotal / scoredRaces : null,
    calibrationError,
    calibration
  };
}

function selectMarketBlend(calibrationRaces, minimumRaces = MINIMUM_BLEND_CALIBRATION_RACES) {
  const usable = calibrationRaces.filter((race) => race.market && race.learned);
  if (usable.length < minimumRaces) return null;
  let best = { marketWeight: 0, logLoss: summarizeProbabilities(usable.map((race) => ({ ...race, candidate: race.learned })), 'candidate').logLoss };
  for (let step = 1; step <= 20; step += 1) {
    const marketWeight = step / 20;
    const candidate = usable.map((race) => ({
      ...race,
      candidate: race.learned.map((probability, index) => probability * (1 - marketWeight) + race.market[index] * marketWeight)
    }));
    const logLoss = summarizeProbabilities(candidate, 'candidate').logLoss;
    if (logLoss < best.logLoss - 1e-12) best = { marketWeight, logLoss };
  }
  return { ...best, races: usable.length };
}

function summarizePlackettLuceRanking(races, strategy) {
  let rankedRaces = 0;
  let ndcgTotal = 0;
  let topThreeSequenceRaces = 0;
  let topThreeSequenceLogLossTotal = 0;
  let exactTopThreeHits = 0;

  for (const race of races) {
    const strengths = normalizeProbabilities(race[strategy]);
    if (!strengths || strengths.length !== race.horses.length) continue;
    const ranked = race.horses
      .map((horse, index) => ({ horse, index, place: Number(horse.finishPosition), strength: strengths[index] }))
      .filter((entry) => Number.isFinite(entry.place) && entry.place > 0);
    if (ranked.length < 2) continue;

    const predicted = [...ranked].sort((a, b) => b.strength - a.strength);
    const relevance = (place) => place === 1 ? 3 : place === 2 ? 2 : place === 3 ? 1 : 0;
    const dcg = predicted.slice(0, 3).reduce((total, entry, index) => total + relevance(entry.place) / Math.log2(index + 2), 0);
    const ideal = [...ranked].sort((a, b) => a.place - b.place).slice(0, 3)
      .reduce((total, entry, index) => total + relevance(entry.place) / Math.log2(index + 2), 0);
    if (ideal > 0) {
      rankedRaces += 1;
      ndcgTotal += dcg / ideal;
    }

    const actualTopThree = ranked.filter((entry) => entry.place <= 3).sort((a, b) => a.place - b.place);
    if (actualTopThree.length !== 3 || new Set(actualTopThree.map((entry) => entry.place)).size !== 3) continue;
    let remainingStrength = strengths.reduce((sum, value) => sum + value, 0);
    let sequenceLogLoss = 0;
    for (const entry of actualTopThree) {
      if (!(remainingStrength > 0) || !(entry.strength > 0)) {
        sequenceLogLoss = null;
        break;
      }
      sequenceLogLoss -= Math.log(entry.strength / remainingStrength);
      remainingStrength -= entry.strength;
    }
    if (!Number.isFinite(sequenceLogLoss)) continue;
    topThreeSequenceRaces += 1;
    topThreeSequenceLogLossTotal += sequenceLogLoss;
    const predictedTopThree = predicted.slice(0, 3).map((entry) => entry.horse.number);
    if (predictedTopThree.every((number, index) => Number(number) === Number(actualTopThree[index].horse.number))) exactTopThreeHits += 1;
  }

  return {
    races: rankedRaces,
    ndcgAt3: rankedRaces ? Number((ndcgTotal / rankedRaces).toFixed(4)) : null,
    topThreeSequenceRaces,
    topThreeSequenceLogLoss: topThreeSequenceRaces ? Number((topThreeSequenceLogLossTotal / topThreeSequenceRaces).toFixed(4)) : null,
    exactTopThreeHits,
    exactTopThreeHitRate: topThreeSequenceRaces ? Number((exactTopThreeHits / topThreeSequenceRaces).toFixed(4)) : null
  };
}

function summarizeWinnerRankContextsByModel(races) {
  const strategies = ['fixed', 'learned', 'market', 'marketBlend'];
  const records = Object.fromEntries(strategies.map((name) => [name, []]));
  for (const race of races) {
    const winnerIndex = race.horses.findIndex((horse) => Number(horse.number) === Number(race.winner));
    if (winnerIndex < 0) continue;
    for (const strategy of strategies) {
      const probabilities = normalizeProbabilities(race[strategy]);
      if (!probabilities || probabilities.length !== race.horses.length) continue;
      const ranked = probabilities.map((probability, index) => ({ probability, index }))
        .sort((a, b) => b.probability - a.probability);
      const rank = ranked.findIndex((entry) => entry.index === winnerIndex) + 1;
      if (rank < 1) continue;
      records[strategy].push({ date: race.date, city: race.city, surface: race.surface, distance: race.distance, rank });
    }
  }
  return Object.fromEntries(Object.entries(records).map(([strategy, values]) => [strategy, summarizeWinnerRankContexts(values)]));
}

function evaluateWalkForward(races, options = {}) {
  const minimumTrainingDates = options.minimumTrainingDates || MINIMUM_TRAINING_DATES;
  const minimumEvidenceFolds = options.minimumEvidenceFolds || MINIMUM_EVIDENCE_FOLDS;
  const maximumFolds = Math.max(2, options.maximumFolds || MAXIMUM_WALK_FORWARD_FOLDS);
  const train = options.fitModel || fitModel;
  const baselineWeights = options.baselineWeights || BASE_WEIGHTS;
  const eligible = (Array.isArray(races) ? races : [])
    .filter((race) => /^\d{4}-\d{2}-\d{2}$/.test(String(race.date || ''))
      && Array.isArray(race.horses)
      && race.horses.length > 1
      && race.horses.some((horse) => Number(horse.number) === Number(race.winner)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(eligible.map((race) => race.date))];
  const outOfSample = [];
  const folds = [];
  let skippedFolds = 0;
  const availableTestDates = dates.slice(minimumTrainingDates);
  const sampledTestDates = availableTestDates.length <= maximumFolds
    ? availableTestDates
    : Array.from({ length: maximumFolds }, (_, index) => availableTestDates[Math.round(index * (availableTestDates.length - 1) / (maximumFolds - 1))]);

  for (const testDate of sampledTestDates) {
    const training = eligible.filter((race) => race.date < testDate);
    const test = eligible.filter((race) => race.date === testDate);
    if (new Set(training.map((race) => race.date)).size < minimumTrainingDates || training.length < 30 || !test.length) {
      skippedFolds += 1;
      continue;
    }
    const fitted = train(training, baselineWeights);
    if (!fitted?.verified || !fitted.weights) {
      skippedFolds += 1;
      continue;
    }

    const untouchedCalibration = training.filter((race) => race.date >= fitted.holdoutStartDate);
    const calibrationRaces = untouchedCalibration.map((race) => ({
      ...race,
      learned: softmaxScores(race.horses, fitted.weights),
      market: marketProbabilities(race.horses)
    }));
    const blend = selectMarketBlend(calibrationRaces);
    folds.push({
      testDate,
      trainingRaces: training.length,
      testRaces: test.length,
      modelUpdated: Boolean(fitted.updated),
      blendCalibrationRaces: blend?.races || 0,
      marketWeight: blend?.marketWeight ?? null
    });
    for (const race of test) {
      const learned = softmaxScores(race.horses, fitted.weights);
      const market = marketProbabilities(race.horses);
      outOfSample.push({
        ...race,
        fixed: softmaxScores(race.horses, baselineWeights),
        learned,
        market,
        marketBlend: blend && market
          ? learned.map((probability, index) => probability * (1 - blend.marketWeight) + market[index] * blend.marketWeight)
          : null
      });
    }
  }

  const byModel = {
    fixed: summarizeProbabilities(outOfSample, 'fixed'),
    learned: summarizeProbabilities(outOfSample, 'learned'),
    market: summarizeProbabilities(outOfSample.filter((race) => race.market), 'market'),
    marketBlend: summarizeProbabilities(outOfSample.filter((race) => race.marketBlend), 'marketBlend')
  };
  const plackettLuceRanking = {
    fixed: summarizePlackettLuceRanking(outOfSample, 'fixed'),
    learned: summarizePlackettLuceRanking(outOfSample, 'learned'),
    market: summarizePlackettLuceRanking(outOfSample.filter((race) => race.market), 'market'),
    marketBlend: summarizePlackettLuceRanking(outOfSample.filter((race) => race.marketBlend), 'marketBlend')
  };
  const winnerRankContextByModel = summarizeWinnerRankContextsByModel(outOfSample);
  return {
    validated: folds.length >= minimumEvidenceFolds,
    reason: folds.length >= minimumEvidenceFolds ? null : `Güvenilir kıyas için her test tarihinden önce en az ${minimumTrainingDates} ayrı eğitim günü ve toplam en az ${minimumTrainingDates + minimumEvidenceFolds} farklı gün gerekir; mevcut arşivde ${dates.length} gün ve ${folds.length} geçerli test dilimi var.`,
    minimumTrainingDates,
    minimumEvidenceFolds,
    maximumFolds,
    folds: folds.length,
    skippedFolds,
    races: outOfSample.length,
    from: folds[0]?.testDate || null,
    to: folds.at(-1)?.testDate || null,
    byModel,
    plackettLuceRanking,
    winnerRankContextByModel,
    foldDetails: folds
  };
}

module.exports = {
  MINIMUM_TRAINING_DATES,
  MINIMUM_EVIDENCE_FOLDS,
  MAXIMUM_WALK_FORWARD_FOLDS,
  MINIMUM_BLEND_CALIBRATION_RACES,
  normalizeProbabilities,
  marketProbabilities,
  summarizeProbabilities,
  summarizePlackettLuceRanking,
  summarizeWinnerRankContextsByModel,
  selectMarketBlend,
  evaluateWalkForward
};
