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
