const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAnalystSignals } = require('./lib/tip-signals');

test('parses labeled race signals without changing the model ranking', () => {
  const signals = parseAnalystSignals(`1. koşu: favorim #2; rakip #1; sürpriz #6, #8\n2. ayak: banko #5`);

  assert.deepEqual(signals, {
    1: { favorite: [2], rival: [1], surprise: [6, 8] },
    2: { banko: [5] }
  });
});

test('ignores unlabeled, malformed, and out-of-range lines', () => {
  assert.deepEqual(parseAnalystSignals('31. koşu: banko #2\n1. koşu: #3, #4\nboş metin'), {});
});
