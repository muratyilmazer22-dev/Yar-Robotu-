const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeEnsemble } = require('./scoring');

test('ensemble exposes average rank without changing consensus score ordering', () => {
  const race = {
    distance: 1400,
    surface: 'Kum',
    type: 'HANDIKAP',
    horses: [
      { number: 1, hp: 90, agf: 40, odds: 2, last6: '111111', sire: 'TOROK', damSire: 'LUXOR' },
      { number: 2, hp: 30, agf: 5, odds: 12, last6: '888888', sire: 'MENDIP', damSire: 'KAIZBERT' }
    ]
  };

  const ranked = analyzeEnsemble(race, { profileScore: () => 80 });

  assert.equal(ranked.length, 2);
  assert.ok(ranked.every((horse) => Number.isFinite(horse.averageRank)));
  assert.deepEqual(ranked.map((horse) => horse.averageRank), [1, 2]);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked.every((horse) => horse.averageRank >= 1 && horse.averageRank <= 2));
});

test('20-criterion shadow scoring reports missing data and normalizes only observed criteria', () => {
  const { analyzeAHPShadow, AHP_CRITERIA } = require('./scoring');
  const race = {
    distance: 1400,
    surface: 'Kum',
    type: 'HANDIKAP',
    horses: [
      { number: 1, hp: 90, agf: 40, odds: 2, last6: '111111', weight: 60, sire: 'TOROK', damSire: 'LUXOR' },
      { number: 2, hp: 30, agf: 5, odds: 12, last6: '888888', weight: 54, sire: 'MENDIP', damSire: 'KAIZBERT' }
    ]
  };

  const experiment = analyzeAHPShadow(race);

  assert.equal(AHP_CRITERIA.length, 20);
  assert.equal(experiment.robotName, '20 Kriter Deterministik Robot');
  assert.match(experiment.robotType, /ana kupondan bağımsız/);
  assert.deepEqual(analyzeAHPShadow(race).ranked, experiment.ranked);
  assert.equal(experiment.totalCriteria, 20);
  assert.equal(experiment.availableCriteria, 5);
  assert.ok(experiment.ranked.every((horse) => horse.criteriaCoverage === 25));
  assert.ok(experiment.ranked.every((horse) => Number.isFinite(horse.modelShare)));
  assert.ok(Math.abs(experiment.ranked[0].modelShare + experiment.ranked[1].modelShare - 1) < 1e-12);
  assert.ok(experiment.criteria.filter((criterion) => !criterion.available).length >= 15);
});

test('missing horse numbers do not collapse runners in main or 20-criterion rankings', () => {
  const { analyzeAHPShadow } = require('./scoring');
  const race = {
    distance: 1400,
    surface: 'Kum',
    type: 'HANDIKAP',
    horses: [
      { name: 'SANÇARLI BEY', hp: 90, agf: 40, odds: 2, last6: '111111', weight: 60 },
      { name: 'FIRTINA BİÇEN', hp: 30, agf: 5, odds: 12, last6: '888888', weight: 54 }
    ]
  };

  const main = analyzeEnsemble(race);
  const experiment = analyzeAHPShadow(race);

  assert.equal(main.length, 2);
  assert.equal(experiment.ranked.length, 2);
  assert.ok(main.every((horse) => horse.number === null));
  assert.deepEqual(new Set(experiment.ranked.map((horse) => horse.name)), new Set(['SANÇARLI BEY', 'FIRTINA BİÇEN']));
});

test('20-criterion shadow scoring does not invent a ranking when all factor data is missing', () => {
  const { analyzeAHPShadow } = require('./scoring');
  const experiment = analyzeAHPShadow({ horses: [{ number: 1 }, { number: 2 }] });

  assert.equal(experiment.availableCriteria, 0);
  assert.deepEqual(experiment.ranked, []);
});
