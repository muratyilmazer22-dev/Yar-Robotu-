const test = require('node:test');
const assert = require('node:assert/strict');
const { assessRaceQuality, createQualityAuditRows, trustedTjkSource } = require('./archive-quality');

test('TJK provenance accepts HTTPS TJK hosts and rejects lookalike or unsafe URLs', () => {
  assert.equal(trustedTjkSource({ tjk: 'https://www.tjk.org/TR/YarisSever' }), true);
  assert.equal(trustedTjkSource({ archive: 'https://results.tjk.org/race' }), true);
  assert.equal(trustedTjkSource({ tjk: 'http://www.tjk.org/race' }), false);
  assert.equal(trustedTjkSource({ tjk: 'https://tjk.org.example.com/race' }), false);
  assert.equal(trustedTjkSource({ tjk: 'https://user:pass@www.tjk.org/race' }), false);
  assert.equal(trustedTjkSource({}), false);
});

test('archive quality distinguishes complete, missing, and inconsistent data', () => {
  const complete = { city: 'Ankara', raceNo: 1, program: { runners: [{ no: 1 }, { no: 2 }] }, results: { runners: [{ no: 1, finishPosition: 1 }, { no: 2, finishPosition: 2 }] } };
  assert.equal(assessRaceQuality(complete).status, 'complete');
  const incomplete = { ...complete, results: { runners: [{ no: 1, finishPosition: 1 }, { no: 1, finishPosition: 1 }] } };
  assert.deepEqual(assessRaceQuality(incomplete).issues, ['duplicate_result_numbers', 'winner_count_invalid']);
});

test('quality audit rejects invalid identities, placements, and results outside the program', () => {
  const base = { city: 'Ankara', raceNo: 1, program: { runners: [{ no: 1 }, { no: 2 }] }, results: { runners: [{ no: 1, finishPosition: 1 }, { no: 2, finishPosition: 2 }] } };
  assert.equal(assessRaceQuality({ ...base, results: { runners: [{ no: 1, finishPosition: null }, { no: 2, finishPosition: 2 }] } }).status, 'needs_review');
  assert.equal(assessRaceQuality({ ...base, results: { runners: [{ no: 3, finishPosition: 1 }] } }).issues.includes('result_runner_not_in_program'), true);
  assert.equal(assessRaceQuality({ ...base, program: { runners: [{ no: 1 }, { no: null }] } }).issues.includes('runner_identity_invalid'), true);
});

test('quality audits store per-race checks and bounded import warnings', () => {
  const rows = createQualityAuditRows('2026-11-24', [{ city: 'Ankara', raceNo: 1, program: { runners: [{ no: 1 }, { no: 2 }] }, results: { runners: [{ no: 1, finishPosition: 1 }] } }], ['fetch issue'], 'test');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventType, 'import_quality');
  assert.equal(rows[0].details.quality.status, 'complete');
  assert.deepEqual(rows[0].details.warnings, ['fetch issue']);
});
