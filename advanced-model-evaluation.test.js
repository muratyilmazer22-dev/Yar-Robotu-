const test = require('node:test');
const assert = require('node:assert/strict');
const { BASE_WEIGHTS } = require('./lib/automatic-learning');
const { normalizeProbabilities, marketProbabilities, summarizeProbabilities, summarizePlackettLuceRanking, summarizeWinnerRankContextsByModel, selectMarketBlend, evaluateWalkForward } = require('./lib/advanced-model-evaluation');

test('probability normalization rejects invalid or degenerate inputs', () => {
  assert.deepEqual(normalizeProbabilities([2, 2]), [0.5, 0.5]);
  assert.equal(normalizeProbabilities([0, 0]), null);
  assert.equal(normalizeProbabilities([0.2, Number.NaN]), null);
  assert.equal(normalizeProbabilities([-1, 2]), null);
});

test('market probabilities require complete, valid pre-race AGF coverage', () => {
  assert.deepEqual(marketProbabilities([{ agf: 25 }, { agf: 75 }]), [0.25, 0.75]);
  assert.equal(marketProbabilities([{ agf: 25 }, { agf: null }]), null);
  assert.equal(marketProbabilities([{ agf: 0 }, { agf: 0 }]), null);
});

test('probability report calculates multiclass Brier, log-loss, top-one and calibration', () => {
  const report = summarizeProbabilities([
    { winner: 1, horses: [{ number: 1 }, { number: 2 }], fixed: [0.8, 0.2] },
    { winner: 2, horses: [{ number: 1 }, { number: 2 }], fixed: [0.25, 0.75] }
  ], 'fixed');
  assert.equal(report.races, 2);
  assert.equal(report.topOneHits, 2);
  assert.equal(report.brier, 0.1025);
  assert.ok(report.logLoss > 0 && report.logLoss < 1);
  assert.ok(report.calibration.length > 0);
  assert.ok(report.calibrationError >= 0 && report.calibrationError <= 1);
});

test('Plackett-Luce ranking report evaluates NDCG@3 and ordered top-three likelihood', () => {
  const race = {
    horses: [
      { number: 1, finishPosition: 1 },
      { number: 2, finishPosition: 2 },
      { number: 3, finishPosition: 3 }
    ],
    strengths: [0.6, 0.3, 0.1]
  };
  const report = summarizePlackettLuceRanking([race], 'strengths');
  const reversed = summarizePlackettLuceRanking([{ ...race, strengths: [0.1, 0.3, 0.6] }], 'strengths');

  assert.equal(report.races, 1);
  assert.equal(report.ndcgAt3, 1);
  assert.equal(report.topThreeSequenceRaces, 1);
  assert.equal(report.exactTopThreeHits, 1);
  assert.ok(Math.abs(report.topThreeSequenceLogLoss - -Math.log(0.45)) < 1e-4);
  assert.ok(reversed.ndcgAt3 < report.ndcgAt3);
  assert.ok(reversed.topThreeSequenceLogLoss > report.topThreeSequenceLogLoss);
});

test('walk-forward context rankings track out-of-sample low-ranked winners by venue, distance, and surface', () => {
  const horses = [
    { number: 1, finishPosition: 2 },
    { number: 2, finishPosition: 3 },
    { number: 3, finishPosition: 4 },
    { number: 4, finishPosition: 1 }
  ];
  const report = summarizeWinnerRankContextsByModel([{
    date: '2026-05-14',
    city: 'İstanbul',
    surface: 'Kum',
    distance: 1200,
    winner: 4,
    horses,
    fixed: [0.7, 0.15, 0.1, 0.05],
    learned: [0.7, 0.15, 0.1, 0.05],
    market: [0.1, 0.2, 0.3, 0.4],
    marketBlend: [0.4, 0.25, 0.2, 0.15]
  }]);

  assert.equal(report.learned.byCity[0].context, 'İstanbul');
  assert.equal(report.learned.byCity[0].lowRankWinnerRate, 100);
  assert.equal(report.learned.byDistanceBand[0].lowRankWinners, 1);
  assert.equal(report.learned.bySurface[0].races, 1);
  assert.equal(report.market.byCity[0].leaderHitRate, 100);
});

test('market blend weight is chosen only with enough earlier calibration races', () => {
  const calibrationRaces = Array.from({ length: 20 }, () => ({
    winner: 2,
    horses: [{ number: 1 }, { number: 2 }],
    learned: [0.9, 0.1],
    market: [0.1, 0.9]
  }));
  assert.equal(selectMarketBlend(calibrationRaces.slice(0, 19)), null);
  const blend = selectMarketBlend(calibrationRaces);
  assert.equal(blend.marketWeight, 1);
  assert.equal(blend.races, 20);
  assert.ok(Math.abs(blend.logLoss + Math.log(0.9)) < 1e-12);
});

test('walk-forward folds train only on earlier race dates and mark too few folds unvalidated', () => {
  const races = Array.from({ length: 23 }, (_, dayIndex) => {
    const date = `2026-01-${String(dayIndex + 1).padStart(2, '0')}`;
    return Array.from({ length: 10 }, (_, raceIndex) => ({
      date,
      winner: 1,
      horses: [
        { number: 1, agf: 70, features: Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 90])) },
        { number: 2, agf: 30, features: Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 20])) }
      ],
      raceId: raceIndex
    }));
  }).flat();
  const report = evaluateWalkForward(races, { minimumEvidenceFolds: 6 });

  assert.equal(report.folds, 5);
  assert.equal(report.races, 50);
  assert.equal(report.from, '2026-01-19');
  assert.equal(report.to, '2026-01-23');
  assert.equal(report.validated, false);
  assert.equal(report.byModel.fixed.races, 50);
  assert.equal(report.byModel.learned.races, 50);
  assert.equal(report.byModel.market.races, 50);
  assert.equal(report.byModel.marketBlend.races, 50);
  assert.equal(report.signalEvaluation.rating.races, 50);
  assert.equal(report.signalEvaluation.rating.excludedRaces, 0);
  assert.equal(report.signalEvaluation.rating.validated, false);
  assert.ok(report.foldDetails.every((fold) => fold.trainingRaces >= 180 && fold.testRaces === 10 && fold.blendCalibrationRaces >= 20));
});

test('walk-forward caps expensive model refits while sampling chronological test dates', () => {
  const races = Array.from({ length: 40 }, (_, dayIndex) => {
    const date = `2026-${String(Math.floor(dayIndex / 28) + 1).padStart(2, '0')}-${String(dayIndex % 28 + 1).padStart(2, '0')}`;
    return Array.from({ length: 4 }, () => ({
      date,
      winner: 1,
      horses: [
        { number: 1, agf: 70, features: Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 90])) },
        { number: 2, agf: 30, features: Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 20])) }
      ]
    }));
  }).flat();
  const report = evaluateWalkForward(races, {
    fitModel: (training) => ({ verified: true, updated: false, weights: BASE_WEIGHTS, holdoutStartDate: training[Math.floor(training.length * 0.8)].date })
  });

  assert.equal(report.maximumFolds, 12);
  assert.equal(report.folds, 12);
  assert.equal(report.races, 48);
  assert.equal(report.from, '2026-01-19');
  assert.equal(report.to, '2026-02-12');
  assert.ok(report.foldDetails.every((fold, index, folds) => index === 0 || fold.testDate > folds[index - 1].testDate));
});

test('walk-forward returns an explicit insufficient-history report instead of fitting a model', () => {
  const report = evaluateWalkForward([]);
  assert.equal(report.validated, false);
  assert.equal(report.folds, 0);
  assert.equal(report.byModel.learned.brier, null);
  assert.match(report.reason, /toplam en az 23 farklı gün/);
});
