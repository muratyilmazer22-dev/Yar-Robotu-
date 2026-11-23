const test = require('node:test');
const assert = require('node:assert/strict');
const { combineRankings } = require('./lib/coupon-combiner');

const horse = (number, name) => ({ number, name, modelShare: 0.5 });

test('combined ranking includes each model selection and favors shared top picks', () => {
  const main = [horse(1, 'ANA LİDER'), horse(2, 'ORTAK AT')];
  const criteria = [horse(2, 'ORTAK AT'), horse(3, 'DENEY ADAYI')];

  const combined = combineRankings(main, criteria);

  assert.deepEqual(combined.map(({ number }) => number), [2, 1, 3]);
  assert.deepEqual(combined.map(({ score }) => score), [75, 50, 25]);
  assert.ok(Math.abs(combined.reduce((sum, item) => sum + item.modelShare, 0) - 1) < 1e-12);
});

test('combined ranking works when the 20-criterion coupon has no selections', () => {
  const combined = combineRankings([horse(7, 'ANA AT')], []);

  assert.deepEqual(combined.map(({ number }) => number), [7]);
  assert.equal(combined[0].score, 100);
  assert.equal(combined[0].modelShare, 1);
});

test('combined ranking keeps distinct named horses when program numbers are missing', () => {
  const combined = combineRankings(
    [horse(null, 'SANÇARLI BEY'), horse(null, 'FIRTINA BİÇEN')],
    [horse(null, 'FIRTINA BİÇEN'), horse(null, 'SANÇARLI BEY')]
  );

  assert.equal(combined.length, 2);
  assert.deepEqual(combined.map(({ name }) => name), ['SANÇARLI BEY', 'FIRTINA BİÇEN']);
});

test('combined ranking is deterministic when both options are unavailable', () => {
  assert.deepEqual(combineRankings([], []), []);
});
