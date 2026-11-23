const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateForwardComparison, mergeOutcome, mergeOutcomes } = require('./lib/learning-evaluation');

function outcome(date, winner = 1) {
  return {
    at: `${date}T12:00:00.000Z`, city: 'İstanbul', raceNo: 1, winner, surface: 'Kum', type: 'Maiden',
    horses: [
      { number: 1, score: 70, marketScore: 30, features: { rating: 90, form: 70 } },
      { number: 2, score: 60, marketScore: 70, features: { rating: 40, form: 60 } }
    ]
  };
}

test('compares stored model, market favorite, and fixed baseline on the same forward dates', () => {
  const outcomes = Array.from({ length: 10 }, (_, index) => outcome(`2026-01-${String(index + 1).padStart(2, '0')}`, 1));
  const report = evaluateForwardComparison(outcomes, { rating: 0.3, form: 0.3, market: 0.25, pedigree: 0.15 });

  assert.equal(report.validated, true);
  assert.equal(report.startDate, '2026-01-09');
  assert.equal(report.races, 2);
  assert.deepEqual([report.byModel.learned.races, report.byModel.favorite.races, report.byModel.fixed.races], [2, 2, 2]);
  assert.equal(report.byContext.find((item) => item.kind === 'surface').eligible, false);
});

test('excludes archive-derived races from prediction-time forward comparison', () => {
  const archiveOutcomes = Array.from({ length: 10 }, (_, index) => ({ ...outcome(`2026-02-${String(index + 1).padStart(2, '0')}`), sourceKey: `tjk:2026-02-${String(index + 1).padStart(2, '0')}:İstanbul:1` }));

  assert.equal(evaluateForwardComparison(archiveOutcomes, { rating: 1 }).validated, false);
});

test('does not claim a forward comparison without five distinct dates', () => {
  const report = evaluateForwardComparison([outcome('2026-01-01'), outcome('2026-01-02')], { rating: 1 });

  assert.equal(report.validated, false);
  assert.equal(report.races, 0);
});

test('uses race identity for deduplication and replaces a corrected winner', () => {
  const original = outcome('2026-01-01', 1);
  const corrected = outcome('2026-01-01', 2);
  const duplicate = mergeOutcome([original], original);
  const correction = mergeOutcome([original], corrected);
  const archiveCorrection = mergeOutcome([original], { ...corrected, sourceKey: 'tjk:2026-01-01:İstanbul:1' });

  assert.equal(duplicate.added, false);
  assert.equal(duplicate.corrected, false);
  assert.equal(correction.corrected, true);
  assert.equal(archiveCorrection.corrected, true);
  assert.equal(archiveCorrection.outcomes.length, 1);
  assert.equal(correction.outcomes[0].winner, 2);
});

test('merges a batch in one pass while preserving duplicate and correction counts', () => {
  const existing = outcome('2026-01-01', 1);
  const corrected = outcome('2026-01-01', 2);
  const added = outcome('2026-01-02', 1);
  const result = mergeOutcomes([existing], [existing, corrected, added, added]);

  assert.equal(result.added, 1);
  assert.equal(result.corrected, 1);
  assert.equal(result.outcomes.length, 2);
  assert.equal(result.outcomes[0].winner, 2);
});
