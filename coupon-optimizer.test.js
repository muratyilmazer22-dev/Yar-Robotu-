const test = require('node:test');
const assert = require('node:assert/strict');
const { getAllocationPriority, prioritizeCoverageCandidate, SURPRISE_COVERAGE_UTILITY_BONUS, getPoolStarts, optimizeCouponCounts } = require('./lib/coupon-optimizer');

function leg(shares, independentCoverage, singleEligible = true) {
  return {
    singleEligible,
    ranked: shares.map((modelShare, index) => ({
      modelShare,
      independentCoverage: index === 0 ? independentCoverage : 100
    }))
  };
}

test('seven-race programs expose first altılı as 1–6 and second altılı as 2–7', () => {
  const races = Array.from({ length: 7 }, (_, index) => ({ no: index + 1 }));

  assert.deepEqual(getPoolStarts(races), [1, 2]);
});

test('second altılı always starts at the next race even when the program has more than seven races', () => {
  const races = Array.from({ length: 8 }, (_, index) => ({ no: index + 1 }));

  assert.deepEqual(getPoolStarts(races), [1, 2]);
});

test('a second altılı is not offered until six races are available from its start', () => {
  const races = Array.from({ length: 6 }, (_, index) => ({ no: index + 1 }));

  assert.deepEqual(getPoolStarts(races), [1]);
});

test('uncertain legs receive greater coverage priority', () => {
  const strong = leg([0.9, 0.1], 100);
  const uncertain = leg([0.6, 0.4], 20);

  assert.ok(getAllocationPriority(uncertain) > getAllocationPriority(strong));
});

test('budget expansion goes to the less reliable leg before the stable leader', () => {
  const strong = leg([0.9, 0.1], 100);
  const uncertain = leg([0.6, 0.4], 20);
  const optimized = optimizeCouponCounts([strong, uncertain], 2, false);

  assert.deepEqual(optimized.counts, [1, 2]);
  assert.equal(optimized.columns, 2);
});

test('a supported surprise candidate is promoted to the second coupon slot without changing its model rank', () => {
  const result = prioritizeCoverageCandidate([
    { number: 1, name: 'Leader', modelShare: 0.65, signal: 'Sinyaller uyumlu' },
    { number: 2, name: 'Second', modelShare: 0.25, signal: 'Sinyaller uyumlu' },
    {
      number: 6,
      name: 'Value runner',
      modelShare: 0.1,
      signal: 'Sürpriz adayı',
      independentCoverage: 60,
      coverage: 55,
      performanceScore: 74,
      marketScore: 60
    }
  ]);

  assert.deepEqual(result.ranked.map((horse) => horse.number), [1, 6, 2]);
  assert.equal(result.ranked[1].modelRank, 3);
  assert.equal(result.ranked[1].coverageCandidate, true);
  assert.deepEqual(result.candidate, { number: 6, name: 'Value runner', modelRank: 3, edge: 14 });
  assert.equal(result.candidateIndex, 1);
});

test('surprise labels without enough independent evidence do not get promoted', () => {
  const result = prioritizeCoverageCandidate([
    { number: 1, modelShare: 0.7, signal: 'Sinyaller uyumlu' },
    { number: 6, modelShare: 0.3, signal: 'Sürpriz adayı', independentCoverage: 20, coverage: 60, performanceScore: 80, marketScore: 50 }
  ]);

  assert.deepEqual(result.ranked.map((horse) => horse.number), [1, 6]);
  assert.equal(result.candidate, null);
});

test('the optimizer allocates a constrained extra slot to a qualified surprise-coverage leg', () => {
  const surpriseLeg = { ...leg([0.9, 0.1], 100), coverageCandidateIndex: 1, coverageBonus: SURPRISE_COVERAGE_UTILITY_BONUS };
  const stableLeg = leg([0.9, 0.1], 100);
  const optimized = optimizeCouponCounts([surpriseLeg, stableLeg], 2, false);

  assert.deepEqual(optimized.counts, [2, 1]);
  assert.equal(optimized.columns, 2);
});

test('unvalidated singles remain blocked in the conservative pass', () => {
  const unvalidated = leg([0.7, 0.3], 100, false);
  const optimized = optimizeCouponCounts([unvalidated], 1, false);

  assert.equal(optimized, null);
});
