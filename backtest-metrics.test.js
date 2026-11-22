const test = require('node:test');
const assert = require('node:assert/strict');
const { getWinnerRank, getWinnerRankBucket } = require('./lib/backtest-metrics');

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
