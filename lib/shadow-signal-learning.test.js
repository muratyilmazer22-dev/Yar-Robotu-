const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSignals, mergeSignals, normalizeCity, raceKey } = require('./shadow-signal-learning');

test('race identity normalizes Turkish venue names while requiring date and race number', () => {
  assert.equal(raceKey('2026-11-26', 'İstanbul', 3), '2026-11-26:ISTANBUL:3');
  assert.equal(raceKey('bad-date', 'İstanbul', 3), null);
  assert.equal(raceKey('2026-11-26', 'İstanbul', 0), null);
  assert.equal(normalizeCity('İzmir'), 'IZMIR');
});

test('shadow signal sanitizer accepts only known categories and valid runner numbers', () => {
  assert.deepEqual(cleanSignals({ banko: [2, 2, 0, 31, '4'], surprise: ['6'], unknown: [1] }), { banko: [2, 4], surprise: [6] });
  assert.equal(cleanSignals({ unknown: [2] }), null);
});

test('signals from multiple authorized sources combine without inventing picks', () => {
  assert.deepEqual(mergeSignals({ banko: [2] }, { banko: [2, 3], favorite: [4] }), { banko: [2, 3], favorite: [4] });
});
