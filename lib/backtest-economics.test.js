const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturnMetrics, recordReturn, finalizeReturnMetrics } = require('./backtest-economics');

test('ROI uses one-unit stakes and only includes races with a published winning price', () => {
  const metrics = createReturnMetrics();
  recordReturn(metrics, { number: 1 }, 1, 3.5);
  recordReturn(metrics, { number: 2 }, 1, 2.25);
  recordReturn(metrics, { number: 1 }, 1, null);
  assert.deepEqual(finalizeReturnMetrics(metrics), {
    races: 3,
    wins: 2,
    pricedRaces: 2,
    grossReturn: 3.5,
    hitRate: 66.7,
    netReturn: 1.5,
    roi: 75
  });
});

test('ROI is unavailable rather than guessed when winning prices are missing', () => {
  const metrics = createReturnMetrics();
  recordReturn(metrics, { number: 1 }, 1, null);
  assert.equal(finalizeReturnMetrics(metrics).roi, null);
  assert.equal(finalizeReturnMetrics(metrics).netReturn, null);
});
