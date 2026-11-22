const test = require('node:test');
const assert = require('node:assert/strict');
const { getAllocationPriority, optimizeCouponCounts } = require('./lib/coupon-optimizer');

function leg(shares, independentCoverage, robotFirstChoiceCount, singleEligible = true) {
  return {
    singleEligible,
    ranked: shares.map((modelShare, index) => ({
      modelShare,
      independentCoverage: index === 0 ? independentCoverage : 100,
      robotFirstChoiceCount: index === 0 ? robotFirstChoiceCount : 0
    }))
  };
}

test('uncertain legs receive greater coverage priority', () => {
  const strong = leg([0.9, 0.1], 100, 8);
  const uncertain = leg([0.6, 0.4], 20, 1);

  assert.ok(getAllocationPriority(uncertain) > getAllocationPriority(strong));
});

test('budget expansion goes to the less reliable leg before the stable leader', () => {
  const strong = leg([0.9, 0.1], 100, 8);
  const uncertain = leg([0.6, 0.4], 20, 1);
  const optimized = optimizeCouponCounts([strong, uncertain], 2, false);

  assert.deepEqual(optimized.counts, [1, 2]);
  assert.equal(optimized.columns, 2);
});

test('unvalidated singles remain blocked in the conservative pass', () => {
  const unvalidated = leg([0.7, 0.3], 100, 8, false);
  const optimized = optimizeCouponCounts([unvalidated], 1, false);

  assert.equal(optimized, null);
});
