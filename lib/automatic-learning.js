const { asc, eq, gte, sql } = require('drizzle-orm');
const { db: defaultDb, pool: defaultPool } = require('./db');
const { raceHistory, robotMemory, raceHistoryAudit, modelTrainingRuns } = require('./db/schema');
const { importTjkDay: defaultImportTjkDay } = require('./tjk');
const scoring = require('../scoring');
const raceContext = require('./race-context');
const classHistory = require('../class-history');
const pedigreeHistory = require('./pedigree-history');
const raceRelations = require('./race-relations');
const { ARCHIVE_RETENTION_DAYS, archiveCutoff, pruneExpiredArchive } = require('./archive-retention');
const { assessRaceQuality, createQualityAuditRows } = require('./archive-quality');

const MODEL_KEY = 'automatic-learning-model';
const MODEL_VERSION = 'deterministic-analysis-v7-head-to-head-lineage';
const MODEL_MIN_RACES = 30;
const TRAINING_WINDOW_RACES = 2000;
const TRAINING_WINDOW_DAYS = ARCHIVE_RETENTION_DAYS;
const BASE_WEIGHTS = scoring.BASE_WEIGHTS;

const trainingCutoff = archiveCutoff;

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

function evaluateHoldout(races, baselineWeights, learnedWeights) {
  const strategies = { learned: { races: 0, wins: 0, pricedRaces: 0, grossReturn: 0 }, fixed: { races: 0, wins: 0, pricedRaces: 0, grossReturn: 0 }, favorite: { races: 0, wins: 0, pricedRaces: 0, grossReturn: 0 } };
  for (const race of races) {
    const winner = race.horses.find((horse) => horse.number === race.winner);
    const candidates = {
      learned: rankForWeights(race.horses, learnedWeights)[0],
      fixed: rankForWeights(race.horses, baselineWeights)[0],
      favorite: [...race.horses].filter((horse) => Number.isFinite(horse.marketScore)).sort((a, b) => b.marketScore - a.marketScore)[0]
    };
    for (const [name, pick] of Object.entries(candidates)) {
      if (!pick) continue;
      const result = strategies[name];
      const won = pick.number === race.winner;
      result.races += 1;
      result.wins += Number(won);
      if (Number.isFinite(winner?.odds) && winner.odds > 0) {
        result.pricedRaces += 1;
        result.grossReturn += won ? winner.odds : 0;
      }
    }
  }
  return Object.fromEntries(Object.entries(strategies).map(([name, item]) => [name, {
    ...item,
    hitRate: item.races ? item.wins / item.races : null,
    netReturn: item.pricedRaces ? item.grossReturn - item.pricedRaces : null,
    roi: item.pricedRaces ? (item.grossReturn - item.pricedRaces) / item.pricedRaces * 100 : null
  }]));
}

function fitModel(races, protectedWeights = BASE_WEIGHTS) {
  const eligible = races.filter((race) => Array.isArray(race.horses) && race.horses.length > 1 && race.horses.some((horse) => horse.number === race.winner) && /^\d{4}-\d{2}-\d{2}$/.test(race.date)).slice(-TRAINING_WINDOW_RACES);
  const dates = [...new Set(eligible.map((race) => race.date))].sort();
  if (eligible.length < MODEL_MIN_RACES || dates.length < 8) return { verified: false, updated: false, sampleSize: eligible.length, trainingRaces: 0, validationRaces: 0, holdoutRaces: 0, weights: protectedWeights };
  const validationStartDate = dates[Math.floor(dates.length * 0.6)];
  const holdoutStartDate = dates[Math.floor(dates.length * 0.8)];
  const training = eligible.filter((race) => race.date < validationStartDate);
  const validation = eligible.filter((race) => race.date >= validationStartDate && race.date < holdoutStartDate);
  const holdout = eligible.filter((race) => race.date >= holdoutStartDate);
  if (training.length < MODEL_MIN_RACES || validation.length < 5 || holdout.length < 5) return { verified: false, updated: false, sampleSize: eligible.length, trainingRaces: training.length, validationRaces: validation.length, holdoutRaces: holdout.length, weights: protectedWeights };

  let candidate = { ...BASE_WEIGHTS };
  for (let epoch = 0; epoch < 300; epoch += 1) {
    const gradient = Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 0]));
    for (const race of training) {
      const probabilities = scoring.softmaxScores(race.horses, candidate);
      race.horses.forEach((horse, index) => {
        const residual = (probabilities[index] - Number(horse.number === race.winner)) / 12.5;
        const available = Object.entries(horse.features || {}).filter(([key, value]) => Number.isFinite(value) && Object.hasOwn(candidate, key));
        const totalWeight = available.reduce((sum, [key]) => sum + candidate[key], 0);
        if (!totalWeight) return;
        const score = available.reduce((sum, [key, value]) => sum + value * candidate[key], 0) / totalWeight;
        for (const [key, value] of available) gradient[key] += residual * (value - score) / totalWeight;
      });
    }
    const rate = 0.08 / training.length;
    candidate = projectWeights(Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, candidate[key] - rate * (gradient[key] + 0.15 * (candidate[key] - BASE_WEIGHTS[key]))])));
  }

  const baselineBrier = brierScore(validation, BASE_WEIGHTS);
  const protectedBrier = brierScore(validation, protectedWeights);
  const candidateBrier = brierScore(validation, candidate);
  const updated = candidateBrier < baselineBrier * 0.98 && candidateBrier < protectedBrier;
  const weights = updated ? candidate : protectedWeights;
  const holdoutEvaluation = evaluateHoldout(holdout, BASE_WEIGHTS, weights);
  return {
    verified: true,
    updated,
    sampleSize: eligible.length,
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

function raceToTrainingExample(row, { contextIndex, classIndex, pedigreeIndex, relationIndex } = {}) {
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
    last6: String(runner.form || '').replace(/[^1-9]/g, '').slice(0, 6),
    sire: String(runner.sire || ''),
    dam: String(runner.dam || ''),
    damSire: String(runner.damSire || ''),
    origin: String(runner.origin || ''),
    rivalFit: raceRelations.scoreAgainstField({ horses: runners.filter((candidate) => !candidate.scratched) }, runner, relationIndex, row.raceDate),
    scratched: Boolean(runner.scratched),
    classHistoryScore: classHistory.scoreForHorse(classIndex || new Map(), runner.name, row.program.raceType || row.program.raceCategory || row.program.title || '', row.raceDate),
    groupFit: classHistory.groupFitForHorse(classIndex || new Map(), runner.name, row.raceDate),
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

async function importDate(date, { database = defaultDb, importDay = defaultImportTjkDay, now = new Date() } = {}) {
  const existing = await database.select().from(raceHistory).where(eq(raceHistory.raceDate, date));
  const imported = await importDay(date);
  const existingByKey = new Map(existing.map((row) => [`${row.city}:${row.raceNo}`, row]));
  const values = imported.records.map((record) => {
    const previous = existingByKey.get(`${record.city}:${record.raceNo}`);
    return {
      raceDate: date,
      city: record.city,
      raceNo: record.raceNo,
      program: record.program?.runners?.length ? record.program : previous?.program || record.program || { runners: [] },
      results: record.results?.runners?.length ? record.results : previous?.results || record.results || { runners: [] },
      sourceUrls: { ...(previous?.sourceUrls || {}), ...(record.sourceUrls || {}) },
      importedAt: new Date()
    };
  });
  let prunedRecords = 0;
  if (values.length) {
    await database.insert(raceHistory).values(values).onConflictDoUpdate({
      target: [raceHistory.raceDate, raceHistory.city, raceHistory.raceNo],
      set: {
        program: sql`excluded.program`,
        results: sql`excluded.results`,
        sourceUrls: sql`excluded.source_urls`,
        importedAt: new Date()
      }
    });
  }
  const retention = await pruneExpiredArchive(database, now);
  prunedRecords = retention.removed;
  if (values.length) await database.insert(raceHistoryAudit).values(createQualityAuditRows(date, values, imported.errors, 'daily_learning'));
  return { date, records: values.length, completedRaces: values.filter((row) => row.results.runners.length > 0).length, prunedRecords, cities: imported.cities, warnings: imported.errors, qualityAuditedRaces: values.length };
}

async function refreshAutomaticModel({ database = defaultDb, now = new Date() } = {}) {
  const cutoff = trainingCutoff(now);
  const rows = await database.select().from(raceHistory).where(gte(raceHistory.raceDate, cutoff)).orderBy(asc(raceHistory.raceDate), asc(raceHistory.city), asc(raceHistory.raceNo));
  const [previous] = await database.select().from(robotMemory).where(eq(robotMemory.memoryKey, MODEL_KEY)).limit(1);
  const previousValue = previous?.memoryValue || {};
  const sameModelVersion = previousValue.model === MODEL_VERSION;
  const protectedWeights = sameModelVersion ? { ...BASE_WEIGHTS, ...(previousValue.weights || {}) } : BASE_WEIGHTS;
  const contextIndex = raceContext.createIndex(rows);
  const classIndex = classHistory.createIndex(rows);
  const pedigreeIndex = pedigreeHistory.createIndex(rows);
  const relationIndex = raceRelations.createIndex(rows);
  const races = rows.map((row) => raceToTrainingExample(row, { contextIndex, classIndex, pedigreeIndex, relationIndex })).filter(Boolean);
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
      validationBrier: fit.validationBrier ?? null
    };
    if (fit.updated) contextWeights[key] = fit.weights;
  }
  const value = {
    version: 3,
    source: 'official-tjk-archive',
    model: MODEL_VERSION,
    learningPolicy: {
      objective: 'Improve forward-validated race outcome probabilities from official race signals in the latest 365 days.',
      strategy: 'Keep the complete historical archive as a backup; train only on the latest 365 days, explore global and venue/surface/race-type/distance contexts, and retain only changes that outperform protected baselines on later dates.',
      guardrails: ['Use past data only', 'Reserve the final 20% of dates as a report-only untouched holdout', 'Require minimum samples and multiple validation dates', 'Regularize toward baseline weights', 'Retain the last verified model when evidence is insufficient'],
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
    trainingWindow: { from: cutoff, to: new Date(now).toISOString().slice(0, 10), days: TRAINING_WINDOW_DAYS },
    refreshedAt: new Date().toISOString()
  };
  await database.insert(robotMemory).values({ memoryKey: MODEL_KEY, memoryValue: value, updatedAt: new Date() }).onConflictDoUpdate({
    target: robotMemory.memoryKey,
    set: { memoryValue: value, updatedAt: new Date() }
  });
  await database.insert(modelTrainingRuns).values({
    modelVersion: value.model,
    trainedAt: new Date(now),
    trainingFrom: report.trainingFrom || null,
    trainingTo: report.trainingTo || null,
    validationFrom: report.validationStartDate || null,
    validationTo: report.validationTo || null,
    holdoutFrom: report.holdoutStartDate || null,
    holdoutTo: report.holdoutTo || null,
    sampleCounts: { eligible: races.length, training: report.trainingRaces || 0, validation: report.validationRaces || 0, holdout: report.holdoutRaces || 0 },
    metrics: { verified: report.verified, accepted: report.updated, baselineBrier: report.baselineBrier ?? null, validationBrier: report.validationBrier ?? null, holdout: report.holdoutEvaluation || null },
    weights: report.weights || protectedWeights,
    accepted: Boolean(report.updated)
  });
  return value;
}

async function runDailyLearning({ database = defaultDb, importDay = defaultImportTjkDay, now = new Date() } = {}) {
  const { year, month, day } = dateInTurkey(now);
  const targetDate = shiftDate(`${year}-${month}-${day}`, -1);
  const imported = await importDate(targetDate, { database, importDay, now });
  const model = await refreshAutomaticModel({ database, now });
  return { imported, model: { completedRaceCount: model.completedRaceCount, trainedRaceCount: model.trainedRaceCount, report: model.report } };
}

module.exports = { MODEL_KEY, BASE_WEIGHTS, TRAINING_WINDOW_DAYS, trainingCutoff, dateInTurkey, shiftDate, fitModel, evaluateHoldout, raceToTrainingExample, importDate, refreshAutomaticModel, runDailyLearning };
