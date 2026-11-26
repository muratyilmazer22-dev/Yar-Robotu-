const test = require('node:test');
const assert = require('node:assert/strict');
const { auditCouponPool, auditRaces } = require('./bulletin-quality');

function sixRaces() {
  return Array.from({ length: 6 }, (_, index) => ({
    no: index + 1,
    distance: 1400,
    horses: [{ horseNumber: 1, name: 'KIR AT' }, { horseNumber: 2, name: 'AK AT' }]
  }));
}

test('accepts a complete six-leg pool with unique race and runner numbers', () => {
  assert.deepEqual(auditCouponPool(sixRaces()), { ok: true });
});

test('blocks incomplete or duplicate race numbers before coupon generation', () => {
  const races = sixRaces();
  races[5].no = races[4].no;
  assert.equal(auditCouponPool(races).ok, false);
  assert.match(auditCouponPool(races).error, /tekrarlı/);
  assert.equal(auditCouponPool(races.slice(0, 5)).ok, false);
});

test('blocks six-leg coupons when any race has already finished', () => {
  const races = sixRaces();
  races[0].finished = true;

  assert.deepEqual(auditCouponPool(races), {
    ok: false,
    code: 'finished-race',
    finishedNos: [1],
    error: 'Altılı kupon için altı açık ayak gerekir; 1. koşu tamamlandı.'
  });
});

test('blocks missing and duplicate active runner numbers, but ignores scratched runners', () => {
  const missing = sixRaces();
  missing[2].horses[0].horseNumber = null;
  assert.match(auditCouponPool(missing).error, /numarası okunamayan at/);

  const duplicate = sixRaces();
  duplicate[3].horses[1].horseNumber = 1;
  assert.match(auditCouponPool(duplicate).error, /yinelenen at numarası/);

  const scratched = sixRaces();
  scratched[3].horses[1] = { horseNumber: 1, scratched: true };
  assert.deepEqual(auditCouponPool(scratched), { ok: true });
});

test('reports unknown distance without inventing a default and flags materially split market signals', () => {
  const races = sixRaces();
  races[0].distance = null;
  races[1].horses[0].agf = 40;
  races[1].horses[0].odds = 6;
  races[1].horses[1].agf = 15;
  races[1].horses[1].odds = 1.5;

  const warnings = auditRaces(races);

  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Mesafe bilgisi okunamadı/);
  assert.match(warnings[1], /AGF lideri.*ganyan favorisi.*farklı/);
});
