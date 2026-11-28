const test = require('node:test');
const assert = require('node:assert/strict');
const { createIndex, parseRaceTime, scoreForHorse } = require('./race-context');
const officialRows = (rows) => rows.map((row) => ({ ...row, sourceUrls: { tjk: 'https://www.tjk.org/TR/test' } }));

test('race times parse common TJK formats and reject malformed values', () => {
  assert.equal(parseRaceTime('1.24.32'), 84.32);
  assert.equal(parseRaceTime('1:24.32'), 84.32);
  assert.equal(parseRaceTime('1:24.5'), 84.5);
  assert.equal(parseRaceTime('1:24.05'), 84.05);
  assert.equal(parseRaceTime('58.40'), 58.4);
  assert.equal(parseRaceTime('1.65.20'), null);
  assert.equal(parseRaceTime('derecesiz'), null);
});

test('historical context ignores archive rows without a verified TJK source URL', () => {
  const index = createIndex([{
    race_date: '2026-11-01',
    city: 'Ankara',
    sourceUrls: { tjk: 'https://tjk.org.invalid/race' },
    program: { distance: 1400, surface: 'Kum', runners: [{ no: 1, name: 'KIR AT', jockey: 'Jokey A', weight: 58 }] },
    results: { runners: [{ no: 1, finishPosition: 1, time: '1.24.00' }] }
  }]);
  const scores = scoreForHorse(index, 'KIR AT', { city: 'Ankara', surface: 'Kum', distance: 1400, jockey: 'Jokey A', weight: 58 }, '2026-11-15');

  assert.equal(scores.venueFit, null);
  assert.equal(scores.jockeyFit, null);
  assert.equal(scores.distanceFit, null);
  assert.equal(scores.weightFit, null);
  assert.equal(scores.timePace, null);
});

test('historical time pace uses only prior same-surface races within 200 meters', () => {
  const archive = [
    { race_date: '2026-11-01', program: { distance: 1400, surface: 'Kum', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 1, time: '1.24.00' }] } },
    { race_date: '2026-11-05', program: { distance: 1500, surface: 'Kum', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 2, time: '1.30.00' }] } },
    { race_date: '2026-11-07', program: { distance: 1400, surface: 'Çim', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 1, time: '1.20.00' }] } },
    { race_date: '2026-11-20', program: { distance: 1400, surface: 'Kum', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 1, time: '1.10.00' }] } }
  ];
  const scores = scoreForHorse(createIndex(officialRows(archive)), 'KIR AT', { distance: 1400, surface: 'Kum' }, '2026-11-15');
  assert.equal(scores.timePace, 60);
});

test('context ratings use only earlier results and distinguish venue, weather, and track changes', () => {
  const archive = [
    { race_date: '2026-11-01', city: 'Ankara', program: { surface: 'Kum', weather: 'Yağmurlu', trackCondition: 'Islak', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 1 }] } },
    { race_date: '2026-11-02', city: 'Ankara', program: { surface: 'Kum', weather: 'Yağmurlu', trackCondition: 'Islak', surfaceChange: 'Çim yerine kum', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 2 }] } },
    { race_date: '2026-11-03', city: 'İzmir', program: { surface: 'Çim', weather: 'Güneşli', trackCondition: 'Normal', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 8 }] } }
  ];
  const index = createIndex(officialRows(archive));
  const scores = scoreForHorse(index, 'KIR AT', { city: 'Ankara', surface: 'Kum', weather: 'Yağmurlu', trackCondition: 'Islak' }, '2026-11-03');
  assert.ok(scores.venueFit > 50);
  assert.ok(scores.weatherFit > 50);
  assert.ok(scores.trackFit > 50);
  const noPriorScores = scoreForHorse(index, 'KIR AT', { city: 'Ankara', surface: 'Kum', weather: 'Yağmurlu', trackCondition: 'Islak' }, '2026-11-01');
  assert.equal(noPriorScores.venueFit, null);
  assert.equal(noPriorScores.jockeyFit, null);
  assert.equal(noPriorScores.distanceFit, null);
  assert.equal(noPriorScores.weightFit, null);
});

test('a first-time runner can use the jockeys earlier surface-and-distance record', () => {
  const archive = [
    { race_date: '2026-10-01', city: 'Ankara', program: { surface: 'Kum', distance: 1400, runners: [{ no: 1, name: 'OTHER HORSE', jockey: 'Jokey A' }] }, results: { runners: [{ no: 1, finishPosition: 1 }] } },
    { race_date: '2026-10-02', city: 'Ankara', program: { surface: 'Çim', distance: 1400, runners: [{ no: 1, name: 'OTHER HORSE 2', jockey: 'Jokey A' }] }, results: { runners: [{ no: 1, finishPosition: 1 }] } }
  ];
  const scores = scoreForHorse(createIndex(officialRows(archive)), 'FIRST TIMER', { city: 'Ankara', surface: 'Kum', distance: 1400, jockey: 'Jokey A' }, '2026-11-01');

  assert.ok(scores.jockeyFit > 50);
  assert.equal(scores.jockeyStarts, 1);
  assert.equal(scores.jockeyWins, 1);
  assert.equal(scores.jockeyHorsePairStarts, 0);
});

test('horse history learns jockey, distance, layoff, and carried-weight signals without future leakage', () => {
  const archive = [
    { race_date: '2026-10-01', city: 'Ankara', program: { distance: 1400, runners: [{ no: 1, name: 'KIR AT', jockey: 'Jokey A', weight: 58 }] }, results: { runners: [{ no: 1, finishPosition: 1 }] } },
    { race_date: '2026-10-29', city: 'Ankara', program: { distance: 1400, runners: [{ no: 1, name: 'KIR AT', jockey: 'Jokey A', weight: 57 }] }, results: { runners: [{ no: 1, finishPosition: 2 }] } },
    { race_date: '2026-11-20', city: 'Ankara', program: { distance: 1400, runners: [{ no: 1, name: 'KIR AT', jockey: 'Jokey A', weight: 58 }] }, results: { runners: [{ no: 1, finishPosition: 9 }] } }
  ];
  const scores = scoreForHorse(createIndex(officialRows(archive)), 'KIR AT', { jockey: 'Jokey A', distance: 1400, weight: 57, date: '2026-11-01' }, '2026-11-01');
  assert.ok(scores.jockeyFit > 50);
  assert.ok(scores.distanceFit > 50);
  assert.equal(scores.restDays, 3);
  assert.ok(scores.restFit > 50);
  assert.ok(scores.weightFit > 50);
});
