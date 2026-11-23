const test = require('node:test');
const assert = require('node:assert/strict');
const { createIndex, parseRaceTime, scoreForHorse } = require('./race-context');

test('race times parse common TJK formats and reject malformed values', () => {
  assert.equal(parseRaceTime('1.24.32'), 84.32);
  assert.equal(parseRaceTime('1:24.32'), 84.32);
  assert.equal(parseRaceTime('58.40'), 58.4);
  assert.equal(parseRaceTime('1.65.20'), null);
  assert.equal(parseRaceTime('derecesiz'), null);
});

test('historical time pace uses only prior same-surface races within 200 meters', () => {
  const archive = [
    { race_date: '2026-11-01', program: { distance: 1400, surface: 'Kum', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 1, time: '1.24.00' }] } },
    { race_date: '2026-11-05', program: { distance: 1500, surface: 'Kum', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 2, time: '1.30.00' }] } },
    { race_date: '2026-11-07', program: { distance: 1400, surface: 'Çim', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 1, time: '1.20.00' }] } },
    { race_date: '2026-11-20', program: { distance: 1400, surface: 'Kum', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 1, time: '1.10.00' }] } }
  ];
  const scores = scoreForHorse(createIndex(archive), 'KIR AT', { distance: 1400, surface: 'Kum' }, '2026-11-15');
  assert.equal(scores.timePace, 60);
});

test('context ratings use only earlier results and distinguish venue, weather, and track changes', () => {
  const archive = [
    { race_date: '2026-11-01', city: 'Ankara', program: { surface: 'Kum', weather: 'Yağmurlu', trackCondition: 'Islak', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 1 }] } },
    { race_date: '2026-11-02', city: 'Ankara', program: { surface: 'Kum', weather: 'Yağmurlu', trackCondition: 'Islak', surfaceChange: 'Çim yerine kum', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 2 }] } },
    { race_date: '2026-11-03', city: 'İzmir', program: { surface: 'Çim', weather: 'Güneşli', trackCondition: 'Normal', runners: [{ no: 1, name: 'KIR AT' }] }, results: { runners: [{ no: 1, finishPosition: 8 }] } }
  ];
  const index = createIndex(archive);
  const scores = scoreForHorse(index, 'KIR AT', { city: 'Ankara', surface: 'Kum', weather: 'Yağmurlu', trackCondition: 'Islak' }, '2026-11-03');
  assert.ok(scores.venueFit > 50);
  assert.ok(scores.weatherFit > 50);
  assert.ok(scores.trackFit > 50);
    assert.deepEqual(scoreForHorse(index, 'KIR AT', { city: 'Ankara', surface: 'Kum', weather: 'Yağmurlu', trackCondition: 'Islak' }, '2026-11-01'), { venueFit: null, weatherFit: null, trackFit: null, jockeyFit: null, distanceFit: null, restFit: null, weightFit: null, restDays: null, timePace: null, timedStarts: 0 });
});

test('horse history learns jockey, distance, layoff, and carried-weight signals without future leakage', () => {
  const archive = [
    { race_date: '2026-10-01', city: 'Ankara', program: { distance: 1400, runners: [{ no: 1, name: 'KIR AT', jockey: 'Jokey A', weight: 58 }] }, results: { runners: [{ no: 1, finishPosition: 1 }] } },
    { race_date: '2026-10-29', city: 'Ankara', program: { distance: 1400, runners: [{ no: 1, name: 'KIR AT', jockey: 'Jokey A', weight: 57 }] }, results: { runners: [{ no: 1, finishPosition: 2 }] } },
    { race_date: '2026-11-20', city: 'Ankara', program: { distance: 1400, runners: [{ no: 1, name: 'KIR AT', jockey: 'Jokey A', weight: 58 }] }, results: { runners: [{ no: 1, finishPosition: 9 }] } }
  ];
  const scores = scoreForHorse(createIndex(archive), 'KIR AT', { jockey: 'Jokey A', distance: 1400, weight: 57, date: '2026-11-01' }, '2026-11-01');
  assert.ok(scores.jockeyFit > 50);
  assert.ok(scores.distanceFit > 50);
  assert.equal(scores.restDays, 3);
  assert.ok(scores.restFit > 50);
  assert.ok(scores.weightFit > 50);
});
