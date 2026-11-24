const test = require('node:test');
const assert = require('node:assert/strict');
const { assessRaceQuality, createQualityAuditRows } = require('./archive-quality');

test('archive quality distinguishes complete, missing, and inconsistent data', () => {
  const complete = { city: 'Ankara', raceNo: 1, program: { runners: [{ no: 1 }, { no: 2 }] }, results: { runners: [{ no: 1, finishPosition: 1 }, { no: 2, finishPosition: 2 }] } };
  assert.equal(assessRaceQuality(complete).status, 'complete');
  const incomplete = { ...complete, results: { runners: [{ no: 1, finishPosition: 1 }, { no: 1, finishPosition: 1 }] } };
  assert.deepEqual(assessRaceQuality(incomplete).issues, ['duplicate_result_numbers', 'winner_count_invalid']);
});

test('quality audits store per-race checks and bounded import warnings', () => {
  const rows = createQualityAuditRows('2026-11-24', [{ city: 'Ankara', raceNo: 1, program: { runners: [{ no: 1 }, { no: 2 }] }, results: { runners: [{ no: 1, finishPosition: 1 }] } }], ['fetch issue'], 'test');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventType, 'import_quality');
  assert.equal(rows[0].details.quality.status, 'complete');
  assert.deepEqual(rows[0].details.warnings, ['fetch issue']);
});
