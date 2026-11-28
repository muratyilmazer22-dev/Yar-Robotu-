const test = require('node:test');
const assert = require('node:assert/strict');
const { MODEL_KEY, MODEL_VERSION, BASE_WEIGHTS, TRAINING_WINDOW_DAYS, MINIMUM_PROMOTION_HOLDOUT_RACES, trainingCutoff, dateInTurkey, fitModel, assessHoldoutPromotion, raceToTrainingExample } = require('./lib/automatic-learning');
const { createIndex } = require('./lib/race-context');
const classHistory = require('./class-history');
const pedigreeHistory = require('./lib/pedigree-history');
const { raceKey } = require('./lib/shadow-signal-learning');

test('model storage key is version-specific and cannot read the legacy shared key', () => {
  assert.equal(MODEL_KEY, `automatic-learning-model:${MODEL_VERSION}`);
  assert.notEqual(MODEL_KEY, 'automatic-learning-model');
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

test('archive training refuses races with missing or invalid finishing positions', () => {
  const row = {
    raceDate: '2026-11-20',
    program: { runners: [{ no: 1, name: 'A' }, { no: 2, name: 'B' }] },
    results: { runners: [{ no: 1, finishPosition: null }, { no: 2, finishPosition: 2 }] }
  };
  assert.equal(raceToTrainingExample(row), null);
});

test('archive training retains zero finish codes so poor recent form stays poor', () => {
  const example = raceToTrainingExample({
    raceDate: '2026-11-20',
    program: { runners: [{ no: 1, name: 'FORM ZERO', form: '000000' }, { no: 2, name: 'FORM ONE', form: '111111' }] },
    results: { runners: [{ no: 1, finishPosition: 2 }, { no: 2, finishPosition: 1 }] }
  });

  assert.equal(example.horses.find((horse) => horse.number === 1).features.form, 0);
  assert.equal(example.horses.find((horse) => horse.number === 2).features.form, 90);
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
  assert.equal(report.promotionGate.passed, false);
  assert.match(report.promotionGate.reasons[0], /en az 20 yarış/);
});

test('model fitter preserves trusted weights until it has a forward validation sample', () => {
  const protectedWeights = { ...BASE_WEIGHTS, market: 0.4 };
  const report = fitModel([], protectedWeights);
  assert.equal(report.verified, false);
  assert.deepEqual(report.weights, protectedWeights);
});

test('automatic model refuses promotion before 18 distinct race dates', () => {
  const protectedWeights = { ...BASE_WEIGHTS, market: 0.4 };
  const races = Array.from({ length: 17 }, (_, dayIndex) => {
    const date = `2026-02-${String(dayIndex + 1).padStart(2, '0')}`;
    return Array.from({ length: 5 }, () => ({
      date,
      winner: 1,
      horses: [
        { number: 1, features: Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 90])) },
        { number: 2, features: Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 20])) }
      ]
    }));
  }).flat();
  const report = fitModel(races, protectedWeights);

  assert.equal(report.verified, false);
  assert.equal(report.trainingDates, 17);
  assert.equal(report.updated, false);
  assert.deepEqual(report.weights, protectedWeights);
});

test('model promotion requires enough untouched holdout races and non-degrading rank metrics', () => {
  const metric = { races: MINIMUM_PROMOTION_HOLDOUT_RACES, brier: 0.4, hitRate: 0.3, topThreeRate: 0.6, lowRankWinnerRate: 0.4 };
  const accepted = assessHoldoutPromotion({ learned: metric, fixed: metric, protected: metric });
  const rejected = assessHoldoutPromotion({
    learned: { ...metric, topThreeRate: 0.5, lowRankWinnerRate: 0.5 },
    fixed: metric,
    protected: metric
  });
  const tooSmall = assessHoldoutPromotion({
    learned: { ...metric, races: MINIMUM_PROMOTION_HOLDOUT_RACES - 1 },
    fixed: metric,
    protected: metric
  });

  assert.equal(accepted.passed, true);
  assert.equal(rejected.passed, false);
  assert.ok(rejected.reasons.some((reason) => reason.includes('ilk-3')));
  assert.ok(rejected.reasons.some((reason) => reason.includes('düşük sıra')));
  assert.equal(tooSmall.passed, false);
});

test('verified shadow analyst signals become training features only on an exact race identity', () => {
  const row = {
    raceDate: '2026-11-25',
    city: 'İstanbul',
    raceNo: 3,
    program: { raceType: 'Handikap', surface: 'Kum', distance: 1400, runners: [{ no: 1, name: 'AT A', handicapPoints: 80 }, { no: 2, name: 'AT B', handicapPoints: 60 }] },
    results: { runners: [{ no: 1, finishPosition: 1, odds: 2 }, { no: 2, finishPosition: 2, odds: 4 }] }
  };
  const shadowSignalsByRace = new Map([[raceKey(row.raceDate, row.city, row.raceNo), { banko: [1] }]]);
  const example = raceToTrainingExample(row, { shadowSignalsByRace });
  const unrelated = raceToTrainingExample({ ...row, raceNo: 4 }, { shadowSignalsByRace });

  assert.equal(example.horses.find((horse) => horse.number === 1).features.analystFit, 100);
  assert.equal(example.horses.find((horse) => horse.number === 2).features.analystFit, null);
  assert.equal(unrelated.horses.every((horse) => horse.features.analystFit === null), true);
});
