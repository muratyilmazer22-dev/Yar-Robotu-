const test = require('node:test');
const assert = require('node:assert/strict');
const { selectionUnits, sameSelection } = require('./ekuri');

test('coupled runners form one selection unit with combined model share', () => {
  const units = selectionUnits([
    { number: 1, name: 'KIR AT', couplingGroup: 'A', score: 70, modelShare: 0.31, independentCoverage: 65 },
    { number: 2, name: 'AK AT', couplingGroup: 'a', score: 66, modelShare: 0.22, independentCoverage: 60 },
    { number: 3, name: 'YEL AT', couplingGroup: '', score: 68, modelShare: 0.47, independentCoverage: 70 }
  ]);

  assert.equal(units.length, 2);
  assert.equal(units[0].isCoupled, true);
  assert.ok(Math.abs(units[0].modelShare - 0.53) < 1e-10);
  assert.deepEqual(units[0].members.map((horse) => horse.number), [1, 2]);
  assert.equal(units[0].number, 1);
  assert.equal(units[1].isCoupled, false);
  assert.equal(units[1].number, 3);
});

test('a win by either member matches the coupled selection', () => {
  assert.equal(sameSelection({ number: 1, couplingGroup: 'A' }, { number: 2, couplingGroup: 'A' }), true);
  assert.equal(sameSelection({ number: 1, couplingGroup: 'A' }, { number: 2, couplingGroup: 'B' }), false);
});
