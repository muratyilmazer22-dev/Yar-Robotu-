const test = require('node:test');
const assert = require('node:assert/strict');
const { classRank, createIndex, scoreForHorse } = require('./class-history');

function archiveRow(date, raceType, place) {
  return {
    race_date: date,
    program: { raceType, runners: [{ horseNumber: 7, name: 'ŞAHİN KIZI' }] },
    results: { runners: [{ horseNumber: 7, finishPosition: place }] }
  };
}

test('class labels are converted into ordered approximate tiers', () => {
  assert.ok(classRank('Grup 1') > classRank('KV-8'));
  assert.ok(classRank('KV-8') > classRank('Handikap 15'));
  assert.ok(classRank('Handikap 15') > classRank('Maiden'));
  assert.equal(classRank('tanımsız'), null);
});

test('uses earlier class-transition results and normalizes Turkish horse names', () => {
  const history = [archiveRow('2026-11-01', 'KV-8', 2)];
  const currentClass = 'Handikap 15';
  const score = scoreForHorse(history, 'Sahin Kizi', currentClass, '2026-11-23');
  const poorRun = scoreForHorse([archiveRow('2026-11-01', 'KV-8', 8)], 'ŞAHİN KIZI', currentClass, '2026-11-23');

  assert.ok(score > 50);
  assert.ok(score > poorRun);
});

test('scores the prebuilt archive index used by automatic model refresh', () => {
  const history = [archiveRow('2026-11-01', 'KV-8', 2)];
  const index = createIndex(history);

  assert.equal(
    scoreForHorse(index, 'ŞAHİN KIZI', 'Handikap 15', '2026-11-23'),
    scoreForHorse(history, 'ŞAHİN KIZI', 'Handikap 15', '2026-11-23')
  );
});

test('excludes same-day and future results to prevent target-race leakage', () => {
  const history = [
    archiveRow('2026-11-23', 'Grup 1', 1),
    archiveRow('2026-11-24', 'Grup 1', 1)
  ];

  assert.equal(scoreForHorse(history, 'ŞAHİN KIZI', 'Handikap 15', '2026-11-23'), null);
});

test('returns no feature when either class or usable result history is absent', () => {
  assert.equal(scoreForHorse([archiveRow('2026-11-01', 'KV-8', 2)], 'ŞAHİN KIZI', 'belirsiz', '2026-11-23'), null);
  assert.equal(scoreForHorse([archiveRow('2026-11-01', 'KV-8', 0)], 'ŞAHİN KIZI', 'Handikap 15', '2026-11-23'), null);
});
