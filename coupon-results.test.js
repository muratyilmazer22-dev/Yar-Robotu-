const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCouponLegs } = require('./lib/coupon-results');

const legs = Array.from({ length: 6 }, (_, index) => ({ raceNo: index + 1, horses: [{ number: index + 1 }] }));

test('reports a five-of-six coupon and identifies the first missed leg', () => {
  const result = evaluateCouponLegs(legs, Array.from({ length: 6 }, (_, index) => ({ raceNo: index + 1, winnerNumber: index === 0 ? 9 : index + 1 })));

  assert.deepEqual(result, { completed: 6, total: 6, hits: 5, missedRaceNos: [1] });
});

test('does not count missing or invalid results as misses', () => {
  const result = evaluateCouponLegs(legs, [{ raceNo: 1, winnerNumber: 1 }, { raceNo: 2, winnerNumber: 0 }]);

  assert.deepEqual(result, { completed: 1, total: 6, hits: 1, missedRaceNos: [] });
});
