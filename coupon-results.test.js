const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCouponLegs, synchronizeCouponResults } = require('./lib/coupon-results');

const legs = Array.from({ length: 6 }, (_, index) => ({ raceNo: index + 1, horses: [{ number: index + 1 }] }));

test('reports a five-of-six coupon and identifies the first missed leg', () => {
  const result = evaluateCouponLegs(legs, Array.from({ length: 6 }, (_, index) => ({ raceNo: index + 1, winnerNumber: index === 0 ? 9 : index + 1 })));

  assert.deepEqual(result, {
    completed: 6,
    total: 6,
    hits: 5,
    missedRaceNos: [1],
    coverageCandidateEvaluated: 0,
    coverageCandidateHits: 0,
    coverageCandidateOutsideHits: 0
  });
});

test('matches saved coupon legs to parsed results and keeps earlier legs on partial updates', () => {
  const coupon = {
    legs,
    legResults: [{ raceNo: 1, winnerNumber: 9 }]
  };
  const changed = synchronizeCouponResults(coupon, [
    { no: 1, horses: [{ number: 1, place: 1 }] },
    { no: 2, horses: [{ number: 2, place: 1 }] },
    { no: 3, horses: [{ number: 0, place: 1 }] },
    { no: 4, horses: [{ number: 4, place: 1 }, { number: 8, place: 1 }] }
  ]);

  assert.equal(changed, true);
  assert.deepEqual(coupon.legResults, [{ raceNo: 1, winnerNumber: 1 }, { raceNo: 2, winnerNumber: 2 }]);
  assert.equal(synchronizeCouponResults(coupon, [{ no: 2, horses: [{ number: 2, place: 1 }] }]), false);
});

test('tracks when an unselected coverage candidate wins', () => {
  const result = evaluateCouponLegs([
    { raceNo: 1, horses: [{ number: 2 }], coverageCandidate: { number: 6, selected: false } },
    ...legs.slice(1)
  ], [{ raceNo: 1, winnerNumber: 6 }]);

  assert.equal(result.hits, 0);
  assert.equal(result.missedRaceNos[0], 1);
  assert.equal(result.coverageCandidateEvaluated, 1);
  assert.equal(result.coverageCandidateHits, 1);
  assert.equal(result.coverageCandidateOutsideHits, 1);
});

test('does not count missing or invalid results as misses', () => {
  const result = evaluateCouponLegs(legs, [{ raceNo: 1, winnerNumber: 1 }, { raceNo: 2, winnerNumber: 0 }]);

  assert.deepEqual(result, {
    completed: 1,
    total: 6,
    hits: 1,
    missedRaceNos: [],
    coverageCandidateEvaluated: 0,
    coverageCandidateHits: 0,
    coverageCandidateOutsideHits: 0
  });
});

test('backtests only complete six-leg system coupons and groups results by actual cost', () => {
  const { evaluateSixLegCoupons } = require('./lib/coupon-results');
  const resultForHits = (hits) => Array.from({ length: 6 }, (_, index) => ({ raceNo: index + 1, winnerNumber: index < hits ? index + 1 : 99 }));
  const generated = (id, cost, hits) => ({
    id, source: 'Yarış Robotu', poolType: 'first', cost, legs, legResults: resultForHits(hits)
  });
  const report = evaluateSixLegCoupons([
    generated('six-of-six', 80, 6),
    generated('five-of-six', 80, 5),
    { ...generated('incomplete', 40, 6), legResults: [{ raceNo: 1, winnerNumber: 1 }] },
    { ...generated('manual', 30, 6), source: 'Harici kupon' },
    { ...generated('wrong-pool', 20, 6), poolType: 'single' }
  ]);

  assert.equal(report.eligibleCoupons, 3);
  assert.equal(report.incompleteCoupons, 1);
  assert.equal(report.evaluatedCoupons, 2);
  assert.equal(report.sixOfSix, 1);
  assert.equal(report.sixOfSixRate, 50);
  assert.equal(report.fiveOfSix, 1);
  assert.equal(report.averageHits, 5.5);
  assert.deepEqual(report.byBudget.map(({ budget, coupons }) => [budget, coupons]), [[80, 2]]);
});

test('aggregate history reports wins caught by coverage candidates outside the original ticket', () => {
  const { evaluateSixLegCoupons } = require('./lib/coupon-results');
  const candidateLegs = legs.map((leg, index) => ({
    ...leg,
    coverageCandidate: index === 0 ? { number: 9, modelRank: 4, selected: false } : null
  }));
  const report = evaluateSixLegCoupons([{
    source: 'Yarış Robotu',
    poolType: 'first',
    cost: 10,
    legs: candidateLegs,
    legResults: Array.from({ length: 6 }, (_, index) => ({ raceNo: index + 1, winnerNumber: index === 0 ? 9 : index + 1 }))
  }]);

  assert.equal(report.coverageCandidateEvaluated, 1);
  assert.equal(report.coverageCandidateHits, 1);
  assert.equal(report.coverageCandidateOutsideHits, 1);
  assert.equal(report.coverageCandidateHitRate, 100);
});

test('reports eligible but incomplete system coupons separately from evaluated coupons', () => {
  const { evaluateSixLegCoupons } = require('./lib/coupon-results');
  const report = evaluateSixLegCoupons([{
    source: 'Yarış Robotu', poolType: 'second', cost: 12.5, legs,
    legResults: [{ raceNo: 1, winnerNumber: 1 }]
  }]);

  assert.equal(report.eligibleCoupons, 1);
  assert.equal(report.evaluatedCoupons, 0);
  assert.equal(report.incompleteCoupons, 1);
  assert.equal(report.sixOfSixRate, null);
});
