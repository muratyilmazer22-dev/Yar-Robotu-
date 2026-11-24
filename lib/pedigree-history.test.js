const test = require('node:test');
const assert = require('node:assert/strict');
const { createIndex, scoreForHorse } = require('./pedigree-history');

function archiveRow(date, surface, distance, names, places) {
  return {
    race_date: date,
    program: {
      surface,
      distance,
      runners: names.map((name, index) => ({ horseNumber: index + 1, name, sire: index === 0 ? 'TOROK' : 'OTHER SIRE', dam: index === 0 ? 'MARE LINE' : 'OTHER DAM', damSire: index === 0 ? 'LUXOR' : 'OTHER DAM SIRE' }))
    },
    results: { runners: places.map((finishPosition, index) => ({ horseNumber: index + 1, finishPosition })) }
  };
}

test('learns sire and damsire performance for the matching surface and distance band', () => {
  const archive = [
    archiveRow('2026-10-01', 'Kum', 1200, ['TOROK FOAL A', 'OTHER A', 'OTHER B'], [1, 2, 3]),
    archiveRow('2026-10-04', 'Kum', 1200, ['TOROK FOAL B', 'OTHER C', 'OTHER D'], [1, 2, 3]),
    archiveRow('2026-10-07', 'Kum', 1200, ['TOROK FOAL C', 'OTHER E', 'OTHER F'], [1, 2, 3]),
    archiveRow('2026-10-10', 'Çim', 1900, ['TOROK FOAL D', 'OTHER G', 'OTHER H'], [3, 2, 1])
  ];
  const index = createIndex(archive);
  const dirtScore = scoreForHorse(index, { sire: 'TOROK', dam: 'MARE LINE', damSire: 'LUXOR' }, { surface: 'Kum', distance: 1200 }, '2026-11-01');
  const turfScore = scoreForHorse(index, { sire: 'TOROK', dam: 'MARE LINE', damSire: 'LUXOR' }, { surface: 'Çim', distance: 1900 }, '2026-11-01');
  const damOnlyScore = scoreForHorse(index, { origin: 'UNKNOWN SIRE - MARE LINE / OTHER DAM SIRE' }, { surface: 'Kum', distance: 1200 }, '2026-11-01');

  assert.ok(dirtScore > turfScore);
  assert.ok(damOnlyScore > 50);
  assert.ok(dirtScore > 50);
});

test('requires three distinct prior offspring and excludes same-day or future results', () => {
  const archive = [
    archiveRow('2026-10-01', 'Kum', 1200, ['TOROK FOAL A', 'OTHER A', 'OTHER B'], [1, 2, 3]),
    archiveRow('2026-10-04', 'Kum', 1200, ['TOROK FOAL B', 'OTHER C', 'OTHER D'], [1, 2, 3]),
    archiveRow('2026-11-01', 'Kum', 1200, ['TOROK FOAL C', 'OTHER E', 'OTHER F'], [1, 2, 3])
  ];
  const index = createIndex(archive);

  assert.equal(scoreForHorse(index, { sire: 'TOROK' }, { surface: 'Kum', distance: 1200 }, '2026-10-04'), null);
  assert.equal(scoreForHorse(index, { sire: 'TOROK' }, { surface: 'Kum', distance: 1200 }, '2026-11-01'), null);
  assert.equal(scoreForHorse(index, { sire: 'TOROK' }, { surface: 'Sentetik', distance: 1200 }, '2026-11-23'), null);
});
