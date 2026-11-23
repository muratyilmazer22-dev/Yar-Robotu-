const test = require('node:test');
const assert = require('node:assert/strict');
const { createIndex, scoreForHorse } = require('./race-context');

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
  assert.deepEqual(scoreForHorse(index, 'KIR AT', { city: 'Ankara', surface: 'Kum', weather: 'Yağmurlu', trackCondition: 'Islak' }, '2026-11-01'), { venueFit: null, weatherFit: null, trackFit: null });
});
