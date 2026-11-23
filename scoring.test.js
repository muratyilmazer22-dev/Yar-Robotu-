const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRace } = require('./scoring');

test('race context selects a distance-specific model before the legacy surface/type fallback', () => {
  const { raceContextKeys } = require('./scoring');
  const race = { surface: 'Kum', type: 'HANDİKAP', distance: 1200 };

  assert.deepEqual(raceContextKeys(race), ['Kum|HANDİKAP|kisa', 'Kum|HANDİKAP']);
  assert.deepEqual(raceContextKeys({ ...race, distance: 1600 }), ['Kum|HANDİKAP|orta', 'Kum|HANDİKAP']);
  assert.deepEqual(raceContextKeys({ ...race, distance: 2000 }), ['Kum|HANDİKAP|uzun', 'Kum|HANDİKAP']);
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
