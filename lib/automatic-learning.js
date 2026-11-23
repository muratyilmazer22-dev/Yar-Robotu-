const { asc, eq, sql } = require('drizzle-orm');
const { db: defaultDb, pool: defaultPool } = require('./db');
const { raceHistory, robotMemory } = require('./db/schema');
const { importTjkDay: defaultImportTjkDay } = require('./tjk');
const scoring = require('../scoring');

const MODEL_KEY = 'automatic-learning-model';
const MODEL_MIN_RACES = 30;
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

function fitModel(races, protectedWeights = BASE_WEIGHTS) {
  const eligible = races.filter((race) => Array.isArray(race.horses) && race.horses.length > 1 && race.horses.some((horse) => horse.number === race.winner) && /^\d{4}-\d{2}-\d{2}$/.test(race.date)).slice(-TRAINING_WINDOW_RACES);
  const dates = [...new Set(eligible.map((race) => race.date))].sort();
  if (eligible.length < MODEL_MIN_RACES || dates.length < 5) return { verified: false, updated: false, sampleSize: eligible.length, trainingRaces: 0, validationRaces: 0, weights: protectedWeights };
  const validationStartDate = dates[Math.floor(dates.length * 0.8)];
  const training = eligible.filter((race) => race.date < validationStartDate);
  const validation = eligible.filter((race) => race.date >= validationStartDate);
  if (training.length < MODEL_MIN_RACES || validation.length < 5) return { verified: false, updated: false, sampleSize: eligible.length, trainingRaces: training.length, validationRaces: validation.length, weights: protectedWeights };

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
  return {
    verified: true,
    updated,
    sampleSize: eligible.length,
    trainingRaces: training.length,
    validationRaces: validation.length,
    validationStartDate,
    baselineBrier,
    validationBrier: updated ? candidateBrier : protectedBrier,
    weights: updated ? candidate : protectedWeights
  };
}

function raceToTrainingExample(row) {
  const runners = Array.isArray(row.program?.runners) ? row.program.runners : [];
  const results = Array.isArray(row.results?.runners) ? row.results.runners : [];
  const winners = results.filter((runner) => Number(runner.finishPosition) === 1);
  if (winners.length !== 1 || runners.length < 2) return null;
  const winner = Number(winners[0].horseNumber ?? winners[0].no);
  const rawHorses = runners.map((runner) => ({
    number: Number(runner.horseNumber ?? runner.no),
    name: String(runner.name || ''),
    hp: Number(runner.handicapPoints) || null,
    agf: Number(runner.agf) || null,
    odds: Number(runner.odds) || null,
    last6: String(runner.form || '').replace(/[^1-9]/g, '').slice(0, 6),
    sire: String(runner.sire || ''),
    damSire: String(runner.damSire || ''),
    scratched: Boolean(runner.scratched),
    classHistoryScore: null
  })).filter((horse) => Number.isSafeInteger(horse.number) && horse.number > 0 && !horse.scratched);
  if (rawHorses.length < 2 || !rawHorses.some((horse) => horse.number === winner)) return null;
  const race = {
    horses: rawHorses,
    distance: Number(row.program.distance) || 1400,
    surface: String(row.program.surface || 'Belirtilmemiş'),
    type: String(row.program.raceCategory || row.program.raceType || 'DİĞER')
  };
  const horses = scoring.analyzeRace(race, { modelWeights: BASE_WEIGHTS }).map((horse) => ({ number: horse.number, features: horse.features }));
  return { date: String(row.raceDate || '').slice(0, 10), winner, horses };
}

async function importDate(date, { database = defaultDb, importDay = defaultImportTjkDay } = {}) {
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
  return { date, records: values.length, completedRaces: values.filter((row) => row.results.runners.length > 0).length, cities: imported.cities, warnings: imported.errors };
}

async function refreshAutomaticModel({ database = defaultDb } = {}) {
  const rows = await database.select().from(raceHistory).orderBy(asc(raceHistory.raceDate), asc(raceHistory.city), asc(raceHistory.raceNo));
  const [previous] = await database.select().from(robotMemory).where(eq(robotMemory.memoryKey, MODEL_KEY)).limit(1);
  const previousValue = previous?.memoryValue || {};
  const protectedWeights = { ...BASE_WEIGHTS, ...(previousValue.weights || {}) };
  const races = rows.map(raceToTrainingExample).filter(Boolean);
  const report = fitModel(races, protectedWeights);
  const value = {
    version: 1,
    source: 'official-tjk-archive',
    model: 'deterministic-analysis-v3',
    weights: report.weights,
    report: { ...report, weights: undefined, updatedAt: new Date().toISOString() },
    completedRaceCount: rows.filter((row) => Array.isArray(row.results?.runners) && row.results.runners.length > 0).length,
    trainedRaceCount: races.length,
    refreshedAt: new Date().toISOString()
  };
  await database.insert(robotMemory).values({ memoryKey: MODEL_KEY, memoryValue: value, updatedAt: new Date() }).onConflictDoUpdate({
    target: robotMemory.memoryKey,
    set: { memoryValue: value, updatedAt: new Date() }
  });
  return value;
}

async function runDailyLearning({ database = defaultDb, importDay = defaultImportTjkDay, now = new Date() } = {}) {
  const { year, month, day } = dateInTurkey(now);
  const targetDate = shiftDate(`${year}-${month}-${day}`, -1);
  const imported = await importDate(targetDate, { database, importDay });
  const model = await refreshAutomaticModel({ database });
  return { imported, model: { completedRaceCount: model.completedRaceCount, trainedRaceCount: model.trainedRaceCount, report: model.report } };
}

module.exports = { MODEL_KEY, BASE_WEIGHTS, dateInTurkey, shiftDate, fitModel, raceToTrainingExample, importDate, refreshAutomaticModel, runDailyLearning };
