const test = require('node:test');
const assert = require('node:assert/strict');
const { BASE_WEIGHTS, TRAINING_WINDOW_DAYS, trainingCutoff, dateInTurkey, fitModel, raceToTrainingExample } = require('./lib/automatic-learning');
const { createIndex } = require('./lib/race-context');
const classHistory = require('./class-history');
const pedigreeHistory = require('./lib/pedigree-history');
const cronHandler = require('./api/cron/daily-learning');

function response() {
  return { statusCode: 200, headers: {}, body: null, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}

test('daily automation handler rejects requests without the configured cron secret', async () => {
  let calls = 0;
  const handler = cronHandler.createDailyLearningHandler({ secret: () => 'private-secret', run: async () => { calls += 1; } });
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls, 0);
});

test('daily automation handler runs only for an authorized GET request', async () => {
  const handler = cronHandler.createDailyLearningHandler({ secret: () => 'private-secret', run: async () => ({ imported: { records: 3 } }) });
  const res = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer private-secret' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, imported: { records: 3 } });
});

test('model training window uses the latest 365 days without deleting older archive rows', () => {
  assert.equal(TRAINING_WINDOW_DAYS, 365);
  assert.equal(trainingCutoff(new Date('2026-11-24T00:00:00.000Z')), '2025-11-24');
});

test('Turkey-local date conversion honors the configured race day timezone', () => {
  assert.deepEqual(dateInTurkey(new Date('2026-11-22T22:30:00.000Z')), { year: '2026', month: '11', day: '23' });
});

test('ambiguous, missing-winner, and unmatched race results are excluded from training', () => {
  const base = { raceDate: '2026-11-22', program: { runners: [{ no: 1 }, { no: 2 }] }, results: { runners: [{ no: 3, finishPosition: 1 }] } };
  assert.equal(raceToTrainingExample(base), null);
  assert.equal(raceToTrainingExample({ ...base, results: { runners: [{ no: 1, finishPosition: 1 }, { no: 2, finishPosition: 1 }] } }), null);
});

test('archive training examples include prior venue, weather, and track performance only', () => {
  const previous = {
    race_date: '2026-11-01', city: 'Ankara',
    program: { raceType: 'Grup 1', distance: 1200, weather: 'Yağmurlu', surface: 'Kum', trackCondition: 'Islak', runners: [
      { no: 1, name: 'KIR AT', handicapPoints: 90, sire: 'TOROK', damSire: 'LUXOR' },
      { no: 2, name: 'RAKİP A', handicapPoints: 85 },
      { no: 3, name: 'RAKİP B', handicapPoints: 80 }
    ] },
    results: { runners: [{ no: 1, finishPosition: 1 }, { no: 2, finishPosition: 2 }, { no: 3, finishPosition: 3 }] }
  };
  const target = {
    raceDate: '2026-11-02', city: 'Ankara',
    program: { raceType: 'Handikap 15', distance: 1200, weather: 'Yağmurlu', surface: 'Kum', trackCondition: 'Islak', raceCategory: 'Maiden', runners: [
      { no: 1, name: 'KIR AT', handicapPoints: 90, sire: 'TOROK', damSire: 'LUXOR' },
      { no: 2, name: 'AK AT', handicapPoints: 70, sire: 'MENDIP', damSire: 'KAIZBERT' }
    ] },
    results: { runners: [{ no: 1, finishPosition: 1 }, { no: 2, finishPosition: 2 }] }
  };
  const example = raceToTrainingExample(target, {
    contextIndex: createIndex([previous]),
    classIndex: classHistory.createIndex([previous]),
    pedigreeIndex: pedigreeHistory.createIndex([previous])
  });
  assert.ok(example.horses[0].features.venueFit > 50);
  assert.ok(example.horses[0].features.classHistory > 50);
  assert.ok(example.horses[0].features.groupFit > 50);
  assert.ok(example.horses[0].features.weatherFit > 50);
  assert.ok(example.horses[0].features.trackFit > 50);
  assert.equal(example.horses[1].features.weatherFit, null);
});

test('historical training uses result odds only for returns, never program odds as prediction inputs', () => {
  const example = raceToTrainingExample({
    raceDate: '2026-11-20',
    program: { runners: [{ no: 1, name: 'A', odds: 1.2 }, { no: 2, name: 'B', odds: 18 }] },
    results: { runners: [{ no: 1, finishPosition: 1, odds: 2.5 }, { no: 2, finishPosition: 2, odds: 10 }] }
  });
  assert.equal(example.horses.find((horse) => horse.number === 1).odds, 2.5);
  assert.equal(example.horses.find((horse) => horse.number === 1).marketScore, null);
});

test('model fitter reserves the final chronological 20 percent as an untouched holdout', () => {
  const dates = Array.from({ length: 20 }, (_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`);
  const races = dates.flatMap((date) => Array.from({ length: 3 }, (_, index) => ({
    date,
    winner: 1,
    horses: [
      { number: 1, features: Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 90])), marketScore: 90, odds: 2.5 },
      { number: 2, features: Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 20])), marketScore: 20, odds: 4 }
    ],
    id: index
  })));
  const report = fitModel(races);

  assert.equal(report.verified, true);
  assert.equal(report.trainingRaces, 36);
  assert.equal(report.validationRaces, 12);
  assert.equal(report.holdoutRaces, 12);
  assert.equal(report.validationStartDate, '2026-01-13');
  assert.equal(report.holdoutStartDate, '2026-01-17');
  assert.equal(report.holdoutEvaluation.learned.pricedRaces, 12);
  assert.equal(report.holdoutEvaluation.learned.roi, 150);
});

test('model fitter preserves trusted weights until it has a forward validation sample', () => {
  const protectedWeights = { ...BASE_WEIGHTS, market: 0.4 };
  const report = fitModel([], protectedWeights);
  assert.equal(report.verified, false);
  assert.deepEqual(report.weights, protectedWeights);
});
