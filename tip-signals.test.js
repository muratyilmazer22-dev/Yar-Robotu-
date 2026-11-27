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

test('parses newspaper favorite, place, and surprise columns for use as soft model evidence', () => {
  const signals = parseAnalystSignals('1. Koşu: Favori 4; Plase 2, 3; Plase Plase 1; Sürpriz 6');
  const { scoreAnalystSignal } = require('./lib/tip-signals');

  assert.deepEqual(signals[1], { favorite: [4], place: [2, 3], surprise: [6] });
  assert.equal(scoreAnalystSignal(4, signals[1]), 92);
  assert.equal(scoreAnalystSignal(2, signals[1]), 76);
  assert.equal(scoreAnalystSignal(6, signals[1]), 52);
  assert.equal(scoreAnalystSignal(9, signals[1]), null);
  assert.equal(scoreAnalystSignal(9, {}), null);
});

test('ignores unlabeled, malformed, and out-of-range lines', () => {
  assert.deepEqual(parseAnalystSignals('31. koşu: banko #2\n1. koşu: #3, #4\nboş metin'), {});
});
