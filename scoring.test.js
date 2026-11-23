const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRace } = require('./scoring');

test('race context discovers venue-specific distance and surface combinations with safe fallbacks', () => {
  const { raceContextKeys } = require('./scoring');
  const race = { city: 'İstanbul', surface: 'Kum', type: 'HANDİKAP', distance: 1200 };

  assert.deepEqual(raceContextKeys(race), ['İSTANBUL|Kum|HANDİKAP|kisa', 'İSTANBUL|Kum|HANDİKAP', 'Kum|HANDİKAP|kisa', 'Kum|HANDİKAP']);
  assert.deepEqual(raceContextKeys({ ...race, distance: 1600 }), ['İSTANBUL|Kum|HANDİKAP|orta', 'İSTANBUL|Kum|HANDİKAP', 'Kum|HANDİKAP|orta', 'Kum|HANDİKAP']);
  assert.deepEqual(raceContextKeys({ ...race, distance: 2000 }), ['İSTANBUL|Kum|HANDİKAP|uzun', 'İSTANBUL|Kum|HANDİKAP', 'Kum|HANDİKAP|uzun', 'Kum|HANDİKAP']);
  assert.deepEqual(raceContextKeys({ ...race, city: '', distance: 1200 }), ['Kum|HANDİKAP|kisa', 'Kum|HANDİKAP']);
});

test('race context uses country and course configuration when those fields are available', () => {
  const { raceContextKeys } = require('./scoring');
  const keys = raceContextKeys({ country: 'Hong Kong', city: 'Sha Tin', venueConfig: 'B+2', surface: 'Turf', type: 'HANDICAP', distance: 1600 });

  assert.equal(keys[0], 'SHA TİN|B+2|Turf|HANDICAP|orta');
  assert.ok(keys.includes('HONG KONG|SHA TİN|Turf|HANDICAP|orta'));
  assert.ok(keys.includes('HONG KONG|Turf|HANDICAP|orta'));
  assert.ok(keys.includes('Turf|HANDICAP|orta'));
});

test('the model prefers an exact distance context over a broader one', () => {
  const race = {
    distance: 1200,
    surface: 'Kum',
    type: 'HANDİKAP',
    horses: [
      { number: 1, hp: 95, agf: 20, odds: 4, last6: '888888' },
      { number: 2, hp: 45, agf: 15, odds: 5, last6: '111111' }
    ]
  };
  const broadOnly = analyzeRace(race, {
    contextWeights: { 'Kum|HANDİKAP': { rating: 0.8, form: 0.05, market: 0.1, pedigree: 0.05 } },
  });
  const exactAndBroad = analyzeRace(race, {
    contextWeights: {
      'Kum|HANDİKAP': { rating: 0.8, form: 0.05, market: 0.1, pedigree: 0.05 },
      'Kum|HANDİKAP|kisa': { rating: 0.05, form: 0.8, market: 0.1, pedigree: 0.05 }
    },
  });

  assert.equal(broadOnly[0].number, 1);
  assert.equal(exactAndBroad[0].number, 2);
});

test('the single model ranks by the active weighted signals', () => {
  const race = {
    distance: 1400,
    surface: 'Kum',
    type: 'HANDIKAP',
    horses: [
      { number: 1, hp: 90, agf: 40, odds: 2, last6: '111111', sire: 'TOROK', damSire: 'LUXOR' },
      { number: 2, hp: 30, agf: 5, odds: 12, last6: '888888', sire: 'MENDIP', damSire: 'KAIZBERT' }
    ]
  };

  const ranked = analyzeRace(race, { profileScore: () => 80 });

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].number, 1);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(Math.abs(ranked.reduce((sum, horse) => sum + horse.modelShare, 0) - 1) < 1e-12);
});

test('historical race-time performance influences ranking when available', () => {
  const race = {
    distance: 1400,
    surface: 'Kum',
    type: 'HANDİKAP',
    horses: [
      { number: 1, timePace: 90 },
      { number: 2, timePace: 96 }
    ]
  };
  const modelWeights = Object.fromEntries(Object.keys(require('./scoring').BASE_WEIGHTS).map((name) => [name, name === 'timeFit' ? 1 : 0]));
  const ranked = analyzeRace(race, { modelWeights });

  assert.equal(ranked[0].number, 1);
  assert.ok(ranked[0].features.timeFit > ranked[1].features.timeFit);
  assert.equal(analyzeRace({ ...race, horses: [{ number: 1, timePace: 60 }, { number: 2 }] }).find((horse) => horse.number === 1).features.timeFit, null);
});

test('venue, weather, and track history signals influence scores when matched data exists', () => {
  const race = {
    distance: 1400, surface: 'Kum', type: 'HANDIKAP',
    horses: [
      { number: 1, rating: 50, venueFit: 90, weatherFit: 90, trackFit: 90 },
      { number: 2, rating: 50, venueFit: 10, weatherFit: 10, trackFit: 10 }
    ]
  };
  for (const key of ['venueFit', 'weatherFit', 'trackFit']) {
    const weights = Object.fromEntries(Object.keys(require('./scoring').BASE_WEIGHTS).map((name) => [name, name === key ? 1 : 0]));
    assert.equal(analyzeRace(race, { modelWeights: weights })[0].number, 1, `${key} should affect the rank`);
  }
});

test('learned class-history evidence influences the ranking without replacing other features', () => {
  const race = {
    distance: 1400,
    surface: 'Kum',
    type: 'HANDİKAP',
    horses: [
      { number: 1, hp: 90, agf: 20, odds: 4, last6: '222222', classHistoryScore: 20 },
      { number: 2, hp: 90, agf: 20, odds: 4, last6: '222222', classHistoryScore: 95 }
    ]
  };

  const ranked = analyzeRace(race);

  assert.equal(ranked[0].number, 2);
  assert.equal(ranked[0].features.classHistory, 95);
  assert.ok(ranked[0].score > ranked[1].score);
});

test('learned group strength influences ranking when prior-group evidence exists', () => {
  const race = {
    distance: 1400,
    surface: 'Kum',
    type: 'HANDİKAP',
    horses: [
      { number: 1, groupFit: 25 },
      { number: 2, groupFit: 90 }
    ]
  };
  const modelWeights = Object.fromEntries(Object.keys(require('./scoring').BASE_WEIGHTS).map((name) => [name, name === 'groupFit' ? 1 : 0]));
  const ranked = analyzeRace(race, { modelWeights });

  assert.equal(ranked[0].number, 2);
  assert.equal(ranked[0].features.groupFit, 90);
});

test('learned pedigree evidence takes precedence over the static sire profile', () => {
  const race = {
    distance: 1400,
    surface: 'Kum',
    type: 'HANDİKAP',
    horses: [
      { number: 1, sire: 'TOROK', pedigreeFit: 20 },
      { number: 2, sire: 'TOROK', pedigreeFit: 95 }
    ]
  };
  const modelWeights = Object.fromEntries(Object.keys(require('./scoring').BASE_WEIGHTS).map((name) => [name, name === 'pedigree' ? 1 : 0]));
  const ranked = analyzeRace(race, { modelWeights, profileScore: () => 99 });

  assert.equal(ranked[0].number, 2);
  assert.equal(ranked[0].features.pedigree, 95);
});

test('missing horse numbers do not collapse distinct runners in the main ranking', () => {
  const race = {
    distance: 1400,
    surface: 'Kum',
    type: 'HANDIKAP',
    horses: [
      { name: 'SANÇARLI BEY', hp: 90, agf: 40, odds: 2, last6: '111111', weight: 60 },
      { name: 'FIRTINA BİÇEN', hp: 30, agf: 5, odds: 12, last6: '888888', weight: 54 }
    ]
  };

  const ranked = analyzeRace(race);

  assert.equal(ranked.length, 2);
  assert.ok(ranked.every((horse) => horse.number === null));
  assert.deepEqual(new Set(ranked.map((horse) => horse.name)), new Set(['SANÇARLI BEY', 'FIRTINA BİÇEN']));
});
