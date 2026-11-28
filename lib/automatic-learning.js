const { and, asc, eq, gte, isNotNull, sql } = require('drizzle-orm');
const { raceHistory, robotMemory, modelTrainingRuns, shadowRaceSignals } = require('./db/schema');
const { MODEL_KEY, MODEL_VERSION } = require('./model-version');
const scoring = require('../scoring');
const raceContext = require('./race-context');
const classHistory = require('../class-history');
const pedigreeHistory = require('./pedigree-history');
const raceRelations = require('./race-relations');
const tipSignals = require('./tip-signals');
const shadowSignalLearning = require('./shadow-signal-learning');
const TRAINING_WINDOW_DAYS = 365;

function trainingCutoff(now = new Date()) {
  return new Date(new Date(now).getTime() - TRAINING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const { assessRaceQuality } = require('./archive-quality');

const MODEL_MIN_RACES = 30;
const MINIMUM_TRAINING_DATES = 18;
const MINIMUM_PROMOTION_HOLDOUT_RACES = 20;
const TRAINING_WINDOW_RACES = 2000;
const BASE_WEIGHTS = scoring.BASE_WEIGHTS;


function dateInTurkey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
}

function shiftDate(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function projectWeights(weights) {
  const positive = Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, Math.max(0.02, Number(weights[key]) || 0.02)]));
  const total = Object.values(positive).reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, positive[key] / total]));
}

function brierScore(races, weights) {
  if (!races.length) return Infinity;
  return races.reduce((total, race) => {
    const probabilities = scoring.softmaxScores(race.horses, weights);
    return total + probabilities.reduce((sum, probability, index) => sum + (probability - (race.horses[index].number === race.winner ? 1 : 0)) ** 2, 0);
  }, 0) / races.length;
}

function rankForWeights(horses, weights) {
  return [...horses].sort((a, b) => {
    const score = (horse) => scoring.weightedFeatureScore(horse.features, weights, weights, horse.marketAgreement).score;
    return score(b) - score(a);
  });
}

function evaluateHoldout(races, baselineWeights, learnedWeights, protectedWeights = baselineWeights) {
  const strategies = Object.fromEntries(['learned', 'fixed', 'protected', 'favorite'].map((name) => [name, {
    races: 0, wins: 0, topThreeHits: 0, lowRankWins: 0, totalWinnerRank: 0,
    brierTotal: 0, brierRaces: 0, pricedRaces: 0, grossReturn: 0
  }]));
  const weightSets = { learned: learnedWeights, fixed: baselineWeights, protected: protectedWeights };
  for (const race of races) {
    const winner = race.horses.find((horse) => horse.number === race.winner);
    const candidates = {
      learned: rankForWeights(race.horses, learnedWeights),
      fixed: rankForWeights(race.horses, baselineWeights),
      protected: rankForWeights(race.horses, protectedWeights),
      favorite: [...race.horses].filter((horse) => Number.isFinite(horse.marketScore)).sort((a, b) => b.marketScore - a.marketScore)
    };
    for (const [name, ranking] of Object.entries(candidates)) {
      const pick = ranking[0];
      if (!pick) continue;
      const result = strategies[name];
      const winnerRank = ranking.findIndex((horse) => Number(horse.number) === Number(race.winner)) + 1;
      if (winnerRank < 1) continue;
      const won = winnerRank === 1;
      result.races += 1;
      result.wins += Number(won);
      result.topThreeHits += Number(winnerRank <= 3);
      result.lowRankWins += Number(winnerRank >= 4);
      result.totalWinnerRank += winnerRank;
      if (weightSets[name]) {
        const probabilities = scoring.softmaxScores(race.horses, weightSets[name]);
        result.brierTotal += probabilities.reduce((sum, probability, index) => sum + (probability - Number(Number(race.horses[index].number) === Number(race.winner))) ** 2, 0);
        result.brierRaces += 1;
      }
      if (Number.isFinite(winner?.odds) && winner.odds > 0) {
        result.pricedRaces += 1;
        result.grossReturn += won ? winner.odds : 0;
      }
    }
  }
  return Object.fromEntries(Object.entries(strategies).map(([name, item]) => [name, {
    ...item,
    hitRate: item.races ? item.wins / item.races : null,
    topThreeRate: item.races ? item.topThreeHits / item.races : null,
    lowRankWinnerRate: item.races ? item.lowRankWins / item.races : null,
    averageWinnerRank: item.races ? item.totalWinnerRank / item.races : null,
    brier: item.brierRaces ? item.brierTotal / item.brierRaces : null,
    netReturn: item.pricedRaces ? item.grossReturn - item.pricedRaces : null,
    roi: item.pricedRaces ? (item.grossReturn - item.pricedRaces) / item.pricedRaces * 100 : null
  }]));
}

function assessHoldoutPromotion(evaluation, minimumRaces = MINIMUM_PROMOTION_HOLDOUT_RACES) {
  const candidate = evaluation?.learned;
  const reasons = [];
  if (!candidate || candidate.races < minimumRaces) {
    reasons.push(`Bağımsız holdout en az ${minimumRaces} yarış olmalı (mevcut: ${candidate?.races || 0}).`);
  }
  for (const baselineName of ['fixed', 'protected']) {
    const baseline = evaluation?.[baselineName];
    if (!candidate || !baseline || !Number.isFinite(candidate.brier) || !Number.isFinite(baseline.brier)) {
      reasons.push(`${baselineName === 'fixed' ? 'Sabit' : 'Korunan'} modele karşı holdout ölçümü eksik.`);
      continue;
    }
    if (candidate.brier > baseline.brier + 1e-12) reasons.push(`Holdout Brier skoru ${baselineName} karşılaştırmasında kötüleşti.`);
    if (candidate.hitRate < baseline.hitRate) reasons.push(`Holdout ilk-sıra isabeti ${baselineName} karşılaştırmasında geriledi.`);
    if (candidate.topThreeRate < baseline.topThreeRate) reasons.push(`Holdout kazanan-ilk-3 oranı ${baselineName} karşılaştırmasında geriledi.`);
    if (candidate.lowRankWinnerRate > baseline.lowRankWinnerRate) reasons.push(`Holdout düşük sıra (4. ve altı) kazanan oranı ${baselineName} karşılaştırmasında arttı.`);
  }
  return { passed: reasons.length === 0, minimumRaces, races: candidate?.races || 0, reasons };
}

function fitModel(races, protectedWeights = BASE_WEIGHTS) {
  const eligible = races.filter((race) => Array.isArray(race.horses) && race.horses.length > 1 && race.horses.some((horse) => horse.number === race.winner) && /^\d{4}-\d{2}-\d{2}$/.test(race.date)).slice(-TRAINING_WINDOW_RACES);
  const dates = [...new Set(eligible.map((race) => race.date))].sort();
  if (eligible.length < MODEL_MIN_RACES || dates.length < MINIMUM_TRAINING_DATES) return {
    verified: false,
    updated: false,
    reason: dates.length < MINIMUM_TRAINING_DATES
      ? `Model güncellenmedi: ileri-tarih doğrulaması için ${MINIMUM_TRAINING_DATES} ayrı yarış günü gerekir; arşivde ${dates.length} gün var.`
      : `Model güncellenmedi: eğitim için en az ${MODEL_MIN_RACES} geçerli koşu gerekir; arşivde ${eligible.length} koşu var.`,
    minimumTrainingDates: MINIMUM_TRAINING_DATES,
    sampleSize: eligible.length,
    trainingDates: dates.length,
    trainingRaces: 0,
    validationRaces: 0,
    holdoutRaces: 0,
    weights: protectedWeights
  };
  const validationStartDate = dates[Math.floor(dates.length * 0.6)];
  const holdoutStartDate = dates[Math.floor(dates.length * 0.8)];
  const training = eligible.filter((race) => race.date < validationStartDate);
  const validation = eligible.filter((race) => race.date >= validationStartDate && race.date < holdoutStartDate);
  const holdout = eligible.filter((race) => race.date >= holdoutStartDate);
  if (training.length < MODEL_MIN_RACES || validation.length < 5 || holdout.length < 5) return {
    verified: false,
    updated: false,
    reason: 'Model güncellenmedi: kronolojik eğitim, doğrulama ve bağımsız holdout dilimleri için yeterli yarış bulunmuyor.',
    minimumTrainingDates: MINIMUM_TRAINING_DATES,
    sampleSize: eligible.length,
    trainingRaces: training.length,
    validationRaces: validation.length,
    holdoutRaces: holdout.length,
    weights: protectedWeights
  };

  let candidate = { ...BASE_WEIGHTS };
  for (let epoch = 0; epoch < 300; epoch += 1) {
    const gradient = Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 0]));
    for (const race of training) {
      const probabilities = scoring.softmaxScores(race.horses, candidate);
      race.horses.forEach((horse, index) => {
        const residual = (probabilities[index] - Number(horse.number === race.winner)) / 12.5;
        const scoreGradient = scoring.weightedFeatureScoreGradient(horse.features, candidate, horse.marketAgreement);
        for (const key of Object.keys(candidate)) gradient[key] += residual * scoreGradient[key];
      });
    }
    const rate = 0.08 / training.length;
    candidate = projectWeights(Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, candidate[key] - rate * (gradient[key] + 0.15 * (candidate[key] - BASE_WEIGHTS[key]))])));
  }

  const baselineBrier = brierScore(validation, BASE_WEIGHTS);
  const protectedBrier = brierScore(validation, protectedWeights);
  const candidateBrier = brierScore(validation, candidate);
  const validationPassed = candidateBrier < baselineBrier * 0.98 && candidateBrier < protectedBrier;
  const promotionEvaluation = evaluateHoldout(holdout, BASE_WEIGHTS, candidate, protectedWeights);
  const promotionGate = assessHoldoutPromotion(promotionEvaluation);
  const updated = validationPassed && promotionGate.passed;
  const weights = updated ? candidate : protectedWeights;
  const holdoutEvaluation = evaluateHoldout(holdout, BASE_WEIGHTS, weights, protectedWeights);
  return {
    verified: true,
    updated,
    validationPassed,
    promotionGate,
    promotionEvaluation,
    sampleSize: eligible.length,
    trainingDates: dates.length,
    trainingRaces: training.length,
    validationRaces: validation.length,
    holdoutRaces: holdout.length,
    trainingFrom: training[0]?.date || null,
    trainingTo: training.at(-1)?.date || null,
    validationStartDate,
    validationTo: validation.at(-1)?.date || null,
    holdoutStartDate,
    holdoutTo: holdout.at(-1)?.date || null,
    baselineBrier,
    validationBrier: updated ? candidateBrier : protectedBrier,
    holdoutEvaluation,
    weights
  };
}

function raceToTrainingExample(row, { contextIndex, classIndex, pedigreeIndex, relationIndex, shadowSignalsByRace } = {}) {
  if (assessRaceQuality(row).status !== 'complete') return null;
  const runners = Array.isArray(row.program?.runners) ? row.program.runners : [];
  const results = Array.isArray(row.results?.runners) ? row.results.runners : [];
  const winners = results.filter((runner) => Number(runner.finishPosition) === 1);
  if (winners.length !== 1 || runners.length < 2) return null;
  const winner = Number(winners[0].horseNumber ?? winners[0].no);
  const resultsByNumber = new Map(results.map((runner) => [Number(runner.horseNumber ?? runner.no), runner]));
  const rawHorses = runners.map((runner) => ({
    number: Number(runner.horseNumber ?? runner.no),
    name: String(runner.name || ''),
    hp: Number(runner.handicapPoints) || null,
    agf: Number(runner.agf) || null,
    last6: String(runner.form || '').replace(/[^0-9]/g, '').slice(0, 6),
    sire: String(runner.sire || ''),
    dam: String(runner.dam || ''),
    damSire: String(runner.damSire || ''),
    origin: String(runner.origin || ''),
    rivalFit: raceRelations.scoreAgainstField({ horses: runners.filter((candidate) => !candidate.scratched) }, runner, relationIndex, row.raceDate),
    scratched: Boolean(runner.scratched),
    classHistoryScore: classHistory.scoreForHorse(classIndex || new Map(), runner.name, row.program.raceType || row.program.raceCategory || row.program.title || '', row.raceDate),
    groupFit: classHistory.groupFitForHorse(classIndex || new Map(), runner.name, row.raceDate),
    analystFit: tipSignals.scoreAnalystSignal(runner.horseNumber ?? runner.no, shadowSignalsByRace?.get(shadowSignalLearning.raceKey(row.raceDate, row.city, row.raceNo))),
    pedigreeFit: pedigreeHistory.scoreForHorse(pedigreeIndex || new Map(), runner, { surface: row.program.surface, distance: row.program.distance }, row.raceDate),
    ...raceContext.scoreForHorse(contextIndex, runner.name, {
      city: row.city,
      weather: row.program.weather,
      surface: row.program.surface,
      trackCondition: row.program.trackCondition,
      surfaceChange: row.program.surfaceChange,
      distance: row.program.distance,
      jockey: runner.jockey,
      weight: runner.weight
    }, row.raceDate)
  })).filter((horse) => Number.isSafeInteger(horse.number) && horse.number > 0 && !horse.scratched);
  if (rawHorses.length < 2 || !rawHorses.some((horse) => horse.number === winner)) return null;
  const race = {
    horses: rawHorses,
        distance: Number.isFinite(Number(row.program.distance)) && Number(row.program.distance) > 0 ? Number(row.program.distance) : null,
    city: String(row.city || ''),
    country: String(row.country || row.program.country || row.program.countryCode || ''),
    venueConfig: String(row.venueConfig || row.program.venueConfig || row.program.courseConfig || row.program.trackConfiguration || ''),
    weather: String(row.program.weather || ''),
    trackCondition: String(row.program.trackCondition || ''),
    surfaceChange: String(row.program.surfaceChange || ''),
    surface: String(row.program.surface || 'Belirtilmemiş'),
    type: String(row.program.raceCategory || row.program.raceType || 'DİĞER')
  };
  const horses = scoring.analyzeRace(race, { modelWeights: BASE_WEIGHTS }).map((horse) => ({ number: horse.number, features: horse.features, marketAgreement: horse.marketAgreement, marketScore: Number.isFinite(horse.marketScore) ? horse.marketScore : null, odds: Number(resultsByNumber.get(horse.number)?.odds) || null }));
  return { date: String(row.raceDate || '').slice(0, 10), winner, horses };
}

async function buildAutomaticModel({ database, now, runId }) {
  const cutoff = trainingCutoff(now);
  const rows = await database.select().from(raceHistory).where(gte(raceHistory.raceDate, cutoff)).orderBy(asc(raceHistory.raceDate), asc(raceHistory.city), asc(raceHistory.raceNo));
  const shadowRows = await database.select({ raceDate: shadowRaceSignals.raceDate, city: shadowRaceSignals.city, raceNo: shadowRaceSignals.raceNo, signals: shadowRaceSignals.signals })
    .from(shadowRaceSignals)
    .where(and(eq(shadowRaceSignals.publishedBeforeRace, true), isNotNull(shadowRaceSignals.sourcePublishedAt), gte(shadowRaceSignals.raceDate, cutoff)))
    .orderBy(asc(shadowRaceSignals.raceDate), asc(shadowRaceSignals.city), asc(shadowRaceSignals.raceNo));
  const shadowSignalsByRace = new Map();
  for (const row of shadowRows) {
    const key = shadowSignalLearning.raceKey(row.raceDate, row.city, row.raceNo);
    if (!key) continue;
    const current = shadowSignalsByRace.get(key) || {};
    shadowSignalsByRace.set(key, shadowSignalLearning.mergeSignals(current, row.signals || {}));
  }
  const [previous] = await database.select().from(robotMemory).where(eq(robotMemory.memoryKey, MODEL_KEY)).limit(1);
  const previousValue = previous?.memoryValue || {};
  const sameModelVersion = previousValue.model === MODEL_VERSION;
  const protectedWeights = sameModelVersion ? { ...BASE_WEIGHTS, ...(previousValue.weights || {}) } : BASE_WEIGHTS;
  const contextIndex = raceContext.createIndex(rows);
  const classIndex = classHistory.createIndex(rows);
  const pedigreeIndex = pedigreeHistory.createIndex(rows);
  const relationIndex = raceRelations.createIndex(rows);
  const races = rows.map((row) => raceToTrainingExample(row, { contextIndex, classIndex, pedigreeIndex, relationIndex, shadowSignalsByRace })).filter(Boolean);
  const shadowMatchedRaceCount = races.filter((race) => race.horses.some((horse) => Number.isFinite(horse.features.analystFit))).length;
  const report = fitModel(races, protectedWeights);
  const contexts = new Map();
  for (const race of races) {
    for (const key of scoring.raceContextKeys(race)) {
      if (!contexts.has(key)) contexts.set(key, []);
      contexts.get(key).push(race);
    }
  }
  const contextWeights = sameModelVersion ? { ...(previousValue.contextWeights || {}) } : {};
  const contextReports = {};
  for (const [key, contextRaces] of contexts) {
    if (contextRaces.length < MODEL_MIN_RACES) continue;
    const fit = fitModel(contextRaces, contextWeights[key] || report.weights);
    contextReports[key] = {
      sampleSize: fit.sampleSize,
      trainingRaces: fit.trainingRaces,
      validationRaces: fit.validationRaces,
      validationStartDate: fit.validationStartDate || null,
      verified: fit.verified,
      updated: fit.updated,
      validationBrier: fit.validationBrier ?? null,
      promotionGate: fit.promotionGate || null
    };
    if (fit.updated) contextWeights[key] = fit.weights;
  }
  const value = {
    version: 3,
    source: 'official-tjk-archive+verified-shadow-signals',
    model: MODEL_VERSION,
    modelKey: MODEL_KEY,
    runId,
    learningPolicy: {
      objective: 'Improve forward-validated race outcome probabilities from official race data and verified pre-race shadow signals in the latest 365 days.',
      strategy: 'Keep the complete historical archive as a backup; train only on the latest 365 days, match user-attested analyst signals by exact date, venue, and race number to complete official outcomes, explore global and venue/surface/race-type/distance contexts, and retain only changes that outperform protected baselines on later dates.',
      guardrails: ['Use past data only', 'Shadow signals require a verified pre-race publication timestamp and exact race identity', 'Exclude incomplete, ambiguous, or unmatched outcomes', 'Reserve the final 20% of dates as an untouched promotion gate', 'Require at least 20 holdout races and non-degrading Brier, top-one, top-three, and low-rank-winner rates versus fixed and protected models', 'Require minimum samples and multiple validation dates', 'Regularize toward baseline weights', 'Retain the last verified model when evidence is insufficient'],
      features: Object.keys(BASE_WEIGHTS)
    },
    weights: report.weights,
    contextWeights,
    contextReports,
    report: { ...report, weights: undefined, updatedAt: new Date().toISOString() },
    holdoutEvaluation: report.holdoutEvaluation || null,
    lastAcceptedValidation: report.updated
      ? {
          from: report.validationStartDate,
          to: report.validationTo || null,
          races: report.validationRaces,
          baselineBrier: report.baselineBrier,
          validationBrier: report.validationBrier,
          validatedAt: new Date().toISOString()
        }
      : (sameModelVersion ? previousValue.lastAcceptedValidation : null) || null,
    completedRaceCount: rows.filter((row) => Array.isArray(row.results?.runners) && row.results.runners.length > 0).length,
    trainedRaceCount: races.length,
    shadowSignalSummary: { saved: shadowRows.length, matchedCompleteRaces: shadowMatchedRaceCount, usedInTraining: shadowMatchedRaceCount > 0 },
    trainingWindow: { from: cutoff, to: new Date(now).toISOString().slice(0, 10), days: TRAINING_WINDOW_DAYS },
    refreshedAt: new Date().toISOString()
  };
  await database.insert(robotMemory).values({ memoryKey: MODEL_KEY, memoryValue: value, updatedAt: new Date() }).onConflictDoUpdate({
    target: robotMemory.memoryKey,
    set: { memoryValue: value, updatedAt: new Date() }
  });
  await database.update(modelTrainingRuns).set({
    modelVersion: value.model,
    trainedAt: new Date(now),
    trainingFrom: report.trainingFrom || null,
    trainingTo: report.trainingTo || null,
    validationFrom: report.validationStartDate || null,
    validationTo: report.validationTo || null,
    holdoutFrom: report.holdoutStartDate || null,
    holdoutTo: report.holdoutTo || null,
    sampleCounts: { eligible: races.length, training: report.trainingRaces || 0, validation: report.validationRaces || 0, holdout: report.holdoutRaces || 0, shadowSignals: shadowRows.length, shadowMatchedRaces: shadowMatchedRaceCount },
    metrics: { status: 'completed', runId, verified: report.verified, accepted: report.updated, baselineBrier: report.baselineBrier ?? null, validationBrier: report.validationBrier ?? null, promotionGate: report.promotionGate || null, shadowSignalsUsed: shadowMatchedRaceCount, holdout: report.holdoutEvaluation || null },
    weights: report.weights || protectedWeights,
    accepted: Boolean(report.updated)
  }).where(eq(modelTrainingRuns.id, runId));
  return value;
}

async function refreshAutomaticModel({ database, now = new Date() } = {}) {
  database = database || require('./db').db;
  const [run] = await database.insert(modelTrainingRuns).values({
    modelVersion: MODEL_VERSION,
    trainedAt: new Date(now),
    sampleCounts: {},
    metrics: { status: 'running' },
    weights: {},
    accepted: false
  }).returning({ id: modelTrainingRuns.id });
  const runId = run.id;

  try {
    return await database.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(1646252177)`);
      const model = await buildAutomaticModel({ database: transaction, now, runId });
      return { ...model, runId };
    });
  } catch (error) {
    try {
      await database.update(modelTrainingRuns).set({
        metrics: { status: 'failed', runId, failureCode: error?.code || 'MODEL_REFRESH_FAILED' },
        accepted: false
      }).where(eq(modelTrainingRuns.id, runId));
    } catch (auditError) {
      console.error('[model-refresh] Could not record failed run:', auditError?.code || 'AUDIT_WRITE_FAILED');
    }
    throw error;
  }
}

module.exports = { MODEL_KEY, MODEL_VERSION, BASE_WEIGHTS, TRAINING_WINDOW_DAYS, MINIMUM_TRAINING_DATES, MINIMUM_PROMOTION_HOLDOUT_RACES, trainingCutoff, dateInTurkey, shiftDate, fitModel, evaluateHoldout, assessHoldoutPromotion, raceToTrainingExample, refreshAutomaticModel };
