const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzePredictionResult, outcomeFromPrediction, raceIdentity } = require('./lib/coupon-learning');

const prediction = {
  date: '2026-11-23', city: 'Bursa', no: 4, modelVersion: 'single-weighted-v1', surface: 'Kum', type: 'HANDİKAP', distance: 1400,
  horses: [
    { number: 2, name: 'At İki', score: 82, modelShare: 0.6, features: { rating: 90, form: 80, market: 70, pedigree: 60 }, marketScore: 75, signal: 'Sinyaller uyumlu' },
    { number: 5, name: 'At Beş', score: 70, modelShare: 0.3, features: { rating: 70, form: 70, market: 60, pedigree: 50 }, marketScore: 60, signal: 'Sürpriz adayı' },
    { number: 7, name: 'At Yedi', score: 55, modelShare: 0.08, features: { rating: 50, form: 50, market: 50, pedigree: 50 }, marketScore: 40, signal: 'Favori riski' },
    { number: 9, name: 'At Dokuz', score: 40, modelShare: 0.02, features: { rating: 40, form: 40, market: 40, pedigree: 40 }, marketScore: 30, signal: 'Veri yetersiz' }
  ]
};

test('result analysis classifies selected hits and model misses by original rank', () => {
  assert.deepEqual(analyzePredictionResult(prediction, 5, [2, 5]), {
    matched: true, winnerRank: 2, selectedHit: true, top3Hit: true, category: 'kupon-isabeti', surface: 'Kum', type: 'HANDİKAP', distance: 1400
  });
  assert.equal(analyzePredictionResult(prediction, 5, [2]).category, 'model-top3-kupon-dışı');
  assert.equal(analyzePredictionResult(prediction, 7, [2]).category, 'model-top3-kupon-dışı');
  assert.equal(analyzePredictionResult(prediction, 9, [2]).category, 'model-sıralaması-geride');
  assert.equal(analyzePredictionResult(prediction, 11, [2]).matched, false);
});

test('matched coupon results become full feature snapshots for validated training', () => {
  const outcome = outcomeFromPrediction(prediction, 5);
  assert.equal(outcome.winner, 5);
  assert.equal(outcome.top3Hit, true);
  assert.equal(outcome.top1Hit, false);
  assert.equal(outcome.horses.length, 4);
  assert.deepEqual(outcome.horses[1].features, prediction.horses[1].features);
  assert.equal(outcome.learningSource, 'coupon-leg-result');
  assert.equal(outcomeFromPrediction(prediction, 11), null);
});

test('race identity is stable for Turkish city spelling and repeated sources', () => {
  assert.equal(raceIdentity({ date: '2026-11-23', city: 'Bursa', raceNo: 4 }), raceIdentity({ at: '2026-11-23T12:00:00.000Z', city: 'BURSA', raceNo: '4' }));
});
