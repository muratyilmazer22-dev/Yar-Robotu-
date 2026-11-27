const test = require('node:test');
const assert = require('node:assert/strict');
const { getWinnerRank, getWinnerRankBucket, summarizeWinnerRankContexts } = require('./lib/backtest-metrics');

test('winner rank is measured against the full model ordering', () => {
  const scores = [{ number: 4 }, { number: 2 }, { number: 9 }, { number: 7 }, { number: 1 }, { number: 8 }, { number: 6 }];
  assert.equal(getWinnerRank(scores, 4), 1);
  assert.equal(getWinnerRank(scores, 9), 3);
  assert.equal(getWinnerRank(scores, 1), 5);
  assert.equal(getWinnerRank(scores, 6), 7);
  assert.equal(getWinnerRank(scores, 3), null);
});

test('winner rank buckets separate strong picks from lower-ranked winners', () => {
  assert.equal(getWinnerRankBucket(1), '1');
  assert.equal(getWinnerRankBucket(2), '2–3');
  assert.equal(getWinnerRankBucket(3), '2–3');
  assert.equal(getWinnerRankBucket(4), '4–6');
  assert.equal(getWinnerRankBucket(6), '4–6');
  assert.equal(getWinnerRankBucket(7), '7+');
  assert.equal(getWinnerRankBucket(null), null);
});

test('winner rank context report separates month, venue, distance, and surface with sample warnings', () => {
  const report = summarizeWinnerRankContexts([
    { date: '2026-01-02', city: 'İstanbul', distance: 1200, surface: 'Kum', rank: 1 },
    { date: '2026-01-03', city: 'İstanbul', distance: 1200, surface: 'Kum', rank: 4 },
    { date: '2026-02-01', city: 'Ankara', distance: 1600, surface: 'Çim', rank: 2 }
  ], 2);

  assert.equal(report.byMonth.length, 2);
  assert.equal(report.byCity.find((group) => group.context === 'İstanbul').lowRankWinnerRate, 50);
  assert.equal(report.byDistanceBand.find((group) => group.context === '1300 m ve altı').lowRankWinners, 1);
  assert.equal(report.bySurface.find((group) => group.context === 'Kum').topThreeWinnerRate, 50);
  assert.equal(report.byCity.find((group) => group.context === 'Ankara').sufficientSample, false);
});
