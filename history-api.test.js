const test = require('node:test');
const assert = require('node:assert/strict');
const historyApi = require('./api/history');
const { verifyFirebaseIdToken } = require('./lib/history-import-security');

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('history API rejects all writes without touching the archive database', async () => {
  let databaseCalls = 0;
  const handler = historyApi.createHistoryHandler({
    database: { select() { databaseCalls += 1; throw new Error('database should not be touched'); } }
  });
  const response = createResponse();

  await handler({ method: 'POST', headers: {}, body: { date: '2026-11-24' } }, response);

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET');
  assert.match(response.body.error, /disabled/i);
  assert.equal(databaseCalls, 0);
});

test('Firebase ID tokens are checked by the configured Firebase project', async (t) => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.apiKey;
  process.env.apiKey = 'test-api-key';
  let requestUrl = '';
  let requestBody = null;
  global.fetch = async (url, options) => {
    requestUrl = String(url);
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ users: [{ localId: 'verified-uid' }] }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.apiKey;
    else process.env.apiKey = originalApiKey;
  });

  assert.equal(await verifyFirebaseIdToken('sample-token'), 'verified-uid');
  assert.match(requestUrl, /identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/);
  assert.deepEqual(requestBody, { idToken: 'sample-token' });
});

test('GET returns the complete archive summary and quality counts', async () => {
  const results = [
    [{ raceCount: 166, firstDate: '2026-11-13', lastDate: '2026-11-23' }],
    [{ raceDate: '2026-11-23', city: 'Ankara', raceNo: 1, importedAt: new Date('2026-11-23T12:00:00Z') }],
    [],
    [{ auditedCount: 166, needsReview: 0 }]
  ];
  let queryIndex = 0;
  const database = {
    select() {
      const result = results[queryIndex++];
      return {
        from() {
          const query = {
            where() { return this; },
            orderBy() { return this; },
            limit() { return Promise.resolve(result); },
            then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); }
          };
          return query;
        }
      };
    }
  };
  const response = createResponse();

  await historyApi.createHistoryHandler({ database })({ method: 'GET', headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.raceCount, 166);
  assert.equal(response.body.firstDate, '2026-11-13');
  assert.equal(response.body.lastDate, '2026-11-23');
  assert.deepEqual(response.body.qualitySummary, { auditedCount: 166, needsReview: 0 });
});
