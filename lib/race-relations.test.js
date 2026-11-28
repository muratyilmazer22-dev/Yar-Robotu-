const test = require('node:test');
const assert = require('node:assert/strict');
const { createIndex, horseInsights, scoreHorseJockeyPair, scoreAgainstField, repeatedJockeysAcrossLegs } = require('./race-relations');

function row(date, runners, places) {
  return {
    race_date: date,
    program: { runners },
    results: { runners: runners.map((runner, index) => ({ horseNumber: runner.horseNumber, finishPosition: places[index] })) }
  };
}

test('counts only earlier starts for the same horse-jockey pairing and head-to-head rival', () => {
  const archive = [
    row('2026-10-01', [
      { name: 'ŞAHİN KIZI', horseNumber: 1, jockey: 'AYŞE JOKEY' },
      { name: 'KARA YEL', horseNumber: 2, jockey: 'BAŞKA JOKEY' }
    ], [1, 2]),
    row('2026-11-20', [
      { name: 'ŞAHİN KIZI', horseNumber: 4, jockey: 'AYŞE JOKEY' },
      { name: 'KARA YEL', horseNumber: 5, jockey: 'BAŞKA JOKEY' }
    ], [2, 1])
  ];
  const race = { no: 1, horses: [{ name: 'Sahin Kizi', jockey: 'Ayşe Jokey' }, { name: 'Kara Yel' }] };
  const insights = horseInsights(race, race.horses[0], archive, '2026-11-23');

  assert.deepEqual(insights.jockey, { available: true, starts: 2, wins: 1, topThree: 2 });
  assert.deepEqual(insights.headToHead, { name: 'KARA YEL', meetings: 2, ahead: 1 });
});

test('scores prior horse-jockey pairing by the same race class without future leakage', () => {
  const archive = [
    { ...row('2026-10-01', [
      { name: 'AT A', horseNumber: 1, jockey: 'JOKEY A' },
      { name: 'AT B', horseNumber: 2, jockey: 'JOKEY B' }
    ], [1, 2]), program: { raceType: 'Açık-3 (G3)', runners: [
      { name: 'AT A', horseNumber: 1, jockey: 'JOKEY A' },
      { name: 'AT B', horseNumber: 2, jockey: 'JOKEY B' }
    ] } },
    { ...row('2026-10-02', [{ name: 'AT A', horseNumber: 3, jockey: 'JOKEY A' }], [1]), program: { raceType: 'Maiden', runners: [{ name: 'AT A', horseNumber: 3, jockey: 'JOKEY A' }] } },
    { ...row('2026-11-23', [{ name: 'AT A', horseNumber: 4, jockey: 'JOKEY A' }], [1]), program: { raceType: 'KV-8', runners: [{ name: 'AT A', horseNumber: 4, jockey: 'JOKEY A' }] } }
  ];
  const pair = scoreHorseJockeyPair(archive, { name: 'AT A', jockey: 'JOKEY A' }, 'Açık-3 (G3)', '2026-11-23');

  assert.deepEqual(pair, { score: 62.5, starts: 1, wins: 1, topThree: 1 });
  assert.equal(scoreHorseJockeyPair(archive, { name: 'AT A', jockey: 'JOKEY A' }, 'Maiden', '2026-11-23').starts, 1);
  assert.equal(scoreHorseJockeyPair(archive, { name: 'AT A', jockey: 'JOKEY A' }, 'KV-8', '2026-11-23'), null);
});

test('scores prior head-to-head finishes against the current field without future leakage', () => {
  const archive = [
    row('2026-10-01', [
      { name: 'AT A', horseNumber: 1, jockey: 'JOKEY A' },
      { name: 'AT B', horseNumber: 2, jockey: 'JOKEY B' }
    ], [1, 2]),
    row('2026-10-02', [
      { name: 'AT A', horseNumber: 3, jockey: 'JOKEY A' },
      { name: 'AT B', horseNumber: 4, jockey: 'JOKEY B' }
    ], [1, 2]),
    row('2026-11-23', [
      { name: 'AT A', horseNumber: 5, jockey: 'JOKEY A' },
      { name: 'AT B', horseNumber: 6, jockey: 'JOKEY B' }
    ], [2, 1])
  ];
  const race = { date: '2026-11-23', horses: [{ name: 'AT A' }, { name: 'AT B' }] };
  const index = createIndex(archive);

  assert.ok(scoreAgainstField(race, race.horses[0], index, race.date) > 50);
  assert.ok(scoreAgainstField(race, race.horses[1], index, race.date) < 50);
  assert.equal(scoreAgainstField({ horses: [{ name: 'AT A' }] }, race.horses[0], index, race.date), null);
});

test('excludes same-day results and counts recurring jockeys by distinct legs', () => {
  const race = { no: 1, horses: [{ name: 'AT', jockey: 'Jokey' }] };
  const sameDay = row('2026-11-23', [{ name: 'AT', horseNumber: 1, jockey: 'Jokey' }], [1]);
  assert.equal(horseInsights(race, race.horses[0], [sameDay], '2026-11-23').jockey.starts, 0);
  assert.equal(repeatedJockeysAcrossLegs([
    { no: 1, horses: [{ jockey: 'Jokey' }, { jockey: '' }] },
    { no: 2, horses: [{ jockey: 'JOKEY' }] },
    { no: 3, horses: [{ jockey: 'Başka' }] }
  ]), 1);
});

test('reports absent jockeys and historical evidence without inventing results', () => {
  const race = { no: 1, horses: [{ name: 'Yeni At', jockey: '' }] };
  assert.deepEqual(horseInsights(race, race.horses[0], [], '2026-11-23'), {
    jockey: { available: false, starts: 0, wins: 0, topThree: 0 },
    headToHead: null
  });
});
