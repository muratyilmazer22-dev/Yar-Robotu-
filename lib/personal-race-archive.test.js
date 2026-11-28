const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArchive, findProgramContext } = require('./personal-race-archive');
const raceContext = require('./race-context');
const { parseRaces } = require('../parser');

const parse = (text) => JSON.parse(text);
const program = (overrides = {}) => ({
  id: 'program-1', kind: 'program', status: 'saved', analysisStatus: 'complete',
  date: '2026-11-20', city: 'İstanbul', savedAt: '2026-11-20T08:00:00.000Z',
  text: JSON.stringify([{ no: 1, distance: 1400, surface: 'Kum', weather: 'Açık', trackCondition: 'Normal', raceType: 'Handikap', horses: [
    { no: 1, name: 'KIR AT', jockey: 'Jokey A', weight: 58, handicapPoints: 70, form: '123456' },
    { no: 2, name: 'GÜZEL AT', jockey: 'Jokey B', weight: 56, handicapPoints: 60, form: '234567' }
  ] }]),
  ...overrides
});
const result = (overrides = {}) => ({
  id: 'result-1', kind: 'result', status: 'saved',
  date: '2026-11-20', city: 'Istanbul', savedAt: '2026-11-20T18:00:00.000Z',
  text: JSON.stringify([{ no: 1, horses: [
    { no: 1, name: 'KIR AT', rank: 1 },
    { no: 2, name: 'GUZEL AT', rank: 2 }
  ] }]),
  ...overrides
});

test('builds personal race history from an exact saved program and result match', () => {
  const rows = buildArchive([program(), result()], parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].city, 'İstanbul');
  assert.equal(rows[0].race_date, '2026-11-20');
  assert.equal(rows[0].race_no, 1);
  assert.equal(rows[0].program.distance, 1400);
  assert.equal(rows[0].program.surface, 'Kum');
  assert.equal(rows[0].program.runners[0].jockey, 'Jokey A');
  assert.equal(rows[0].results.runners[0].finishPosition, 1);
  const index = raceContext.createIndex(rows);
  assert.ok(raceContext.scoreForHorse(index, 'KIR AT', { city: 'İstanbul', jockey: 'Jokey A', distance: 1400, surface: 'Kum' }, '2026-11-21').venueFit > 50);
  assert.equal(raceContext.scoreForHorse(index, 'KIR AT', { city: 'İstanbul', jockey: 'Jokey A', distance: 1400, surface: 'Kum' }, '2026-11-20').venueFit, null);
});

test('does not match when date, venue, horse number, or horse name differs', () => {
  assert.equal(buildArchive([program(), result({ city: 'Ankara' })], parse).length, 0);
  assert.equal(buildArchive([program(), result({ date: '2026-11-21' })], parse).length, 0);
  const wrongNumber = result({ text: JSON.stringify([{ no: 1, horses: [{ no: 3, name: 'KIR AT', rank: 1 }, { no: 2, name: 'GUZEL AT', rank: 2 }] }]) });
  assert.equal(buildArchive([program(), wrongNumber], parse).length, 0);
  const wrongName = result({ text: JSON.stringify([{ no: 1, horses: [{ no: 1, name: 'BAŞKA AT', rank: 1 }, { no: 2, name: 'GUZEL AT', rank: 2 }] }]) });
  assert.equal(buildArchive([program(), wrongName], parse).length, 0);
});

test('does not consume unanalysed programs or programs saved after the result', () => {
  assert.equal(buildArchive([program({ analysisStatus: 'parse-failed' }), result()], parse).length, 0);
  assert.equal(buildArchive([program({ savedAt: '2026-11-20T19:00:00.000Z' }), result()], parse).length, 0);
});

test('refuses ambiguous matches across dates when no context is provided', () => {
  const otherDay = program({ id: 'program-2', date: '2026-11-21', savedAt: '2026-11-21T08:00:00.000Z' });
  const rows = JSON.parse(result().text);
  assert.equal(findProgramContext(rows, [program(), otherDay], parse), null);
});

test('matches real tab-separated program and results parsed by the app parser', () => {
  const programText = [
    '1. Koşu 14:00 Handikap 1400 Kum',
    'N\tAt İsmi\tJokey\tSiklet\tHP\tAGF\tGNY\tForm',
    '1\tKIR AT\tJokey A\t58\t72\t%24\t2,40\t112321',
    '2\tGÜZEL AT\tJokey B\t56\t55\t%10\t5,20\t223451'
  ].join('\n');
  const resultText = [
    '1. Koşu 1400 Kum',
    'N\tAt İsmi\tSıra\tDerece',
    '1\tKIR AT\t1\t1.23.45',
    '2\tGÜZEL AT\t2\t1.24.10'
  ].join('\n');
  const rows = buildArchive([
    program({ text: programText }),
    result({ text: resultText })
  ], parseRaces);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].program.distance, 1400);
  assert.equal(rows[0].program.runners[0].jockey, 'Jokey A');
  assert.equal(rows[0].results.runners[0].finishPosition, 1);
});
