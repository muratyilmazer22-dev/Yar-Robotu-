const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateForwardComparison, isPersonalBulletinOutcome, mergeOutcome, mergeOutcomes } = require('./lib/learning-evaluation');

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

test('only user bulletin outcomes are eligible for personal learning', () => {
  const personal = outcome('2026-02-01');
  const archive = { ...outcome('2026-02-02'), sourceKey: 'tjk:2026-02-02:İstanbul:1' };

  assert.equal(isPersonalBulletinOutcome(personal), true);
  assert.equal(isPersonalBulletinOutcome(archive), false);
  assert.equal(evaluateForwardComparison([archive], { rating: 1 }).validated, false);
});

test('user bulletin outcomes take precedence over official archive duplicates', () => {
  const personal = outcome('2026-02-01', 2);
  const archive = { ...outcome('2026-02-01', 1), sourceKey: 'tjk:2026-02-01:İstanbul:1' };
  const archiveFirst = mergeOutcome([archive], personal);
  const personalFirst = mergeOutcome([personal], archive);

  assert.equal(archiveFirst.outcomes[0].winner, 2);
  assert.equal(archiveFirst.outcomes[0].sourceKey, undefined);
  assert.equal(archiveFirst.added, true);
  assert.equal(personalFirst.outcomes[0].winner, 2);
  assert.equal(personalFirst.corrected, false);
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
  assert.equal(archiveCorrection.corrected, false);
  assert.equal(archiveCorrection.outcomes[0].winner, 1);
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
