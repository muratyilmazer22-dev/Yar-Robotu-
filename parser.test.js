const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRaces } = require('./parser');

test('parses tabular race bulletins by their column headers', () => {
  const bulletin = [
    '1. Koşu 14:00 Maiden 1400 Kum',
    'At İsmi\tHP\tAGF\tGNY\tForm\tOrijin',
    'KIR AT (1)\t72\t%24\t2,40\t112321\tTOROK - ANOTHER / LUXOR',
    'AK AT (2)\t55\t%10\t5,20\t223451\tMENDIP - EXAMPLE / KAIZBERT'
  ].join('\n');

  const [race] = parseRaces(bulletin);

  assert.equal(race.no, 1);
  assert.equal(race.distance, 1400);
  assert.equal(race.surface, 'Kum');
  assert.equal(race.horses.length, 2);
  assert.equal(race.horses[0].horseNumber, 1);
  assert.equal(race.horses[0].handicapPoints, 72);
  assert.equal(race.horses[0].agf, 24);
  assert.equal(race.horses[0].odds, 2.4);
  assert.equal(race.horses[0].form, '112321');
  assert.equal(race.horses[0].damSire, 'LUXOR');
  assert.equal(race.horses[0].rank, 0);
});

test('reads finishing positions from result-table headers', () => {
  const results = [
    '1. Koşu 14:00 Maiden 1400 Kum',
    'At İsmi\tSıra\tDerece',
    'KIR AT (1)\t1\t1.23.45',
    'AK AT (2)\t2\t1.24.10'
  ].join('\n');

  const [race] = parseRaces(results);

  assert.deepEqual(race.horses.map((horse) => horse.rank), [1, 2]);
});
