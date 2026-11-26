const test = require('node:test');
const assert = require('node:assert/strict');
const { createShadowSignalsHandler } = require('./shadow-signals');

function responseStub() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function fakeDatabase(rows) {
  return {
    insert() {
      return { values(row) { return { onConflictDoUpdate: async () => rows.push(row) }; } };
    }
  };
}

test('shadow signals require a verified account before any database write', async () => {
  const rows = [];
  const handler = createShadowSignalsHandler({ database: fakeDatabase(rows), verifyToken: async () => null });
  const response = responseStub();

  await handler({ method: 'POST', headers: {}, body: { records: [{ raceDate: '2026-11-26', city: 'İzmir', raceNo: 2, signals: { banko: [1] } }] } }, response);

  assert.equal(response.statusCode, 401);
  assert.equal(rows.length, 0);
});

test('unverified timing is stored as shadow-only and pre-race verified timing is eligible', async () => {
  const rows = [];
  const handler = createShadowSignalsHandler({ database: fakeDatabase(rows), verifyToken: async () => 'firebase-user-1' });
  const response = responseStub();
  const records = [
    { raceDate: '2026-11-26', city: 'İzmir', raceNo: 2, signals: { banko: [1], unknown: [9] }, publishedBeforeRace: false },
    { raceDate: '2026-11-26', city: 'İzmir', raceNo: 3, signals: { favorite: [4] }, sourcePublishedAt: '2026-11-25T10:00:00.000Z', publishedBeforeRace: true }
  ];

  await handler({ method: 'POST', headers: { authorization: 'Bearer valid' }, body: { records } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.saved, 2);
  assert.equal(response.body.pending, 1);
  assert.equal(rows[0].publishedBeforeRace, false);
  assert.deepEqual(rows[0].signals, { banko: [1] });
  assert.equal(rows[1].publishedBeforeRace, true);
  assert.equal(rows[1].ownerId, 'firebase-user-1');
});

test('same-day source timestamps are never promoted to pre-race training data', async () => {
  const rows = [];
  const handler = createShadowSignalsHandler({ database: fakeDatabase(rows), verifyToken: async () => 'firebase-user-1' });
  const response = responseStub();

  await handler({ method: 'POST', headers: { authorization: 'Bearer valid' }, body: { records: [{ raceDate: '2026-11-26', city: 'İzmir', raceNo: 2, signals: { banko: [1] }, sourcePublishedAt: '2026-11-26T08:00:00.000Z', publishedBeforeRace: true }] } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(rows[0].publishedBeforeRace, false);
});
