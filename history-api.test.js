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

function createRequest({ method = 'POST', date = new Date().toISOString().slice(0, 10), token, body } = {}) {
  return {
    method,
    headers: { 'x-forwarded-for': '203.0.113.10', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? { date } : body
  };
}

function createDatabase({ existing = [] } = {}) {
  let inserted = [];
  const operations = [];
  return {
    get inserted() { return inserted; },
    get operations() { return operations; },
    delete() {
      return { where() { return { returning: async () => { operations.push('prune'); return []; } }; } };
    },
    select() {
      return {
        from() {
          return {
            where: async () => existing,
            orderBy() { return { limit: async () => [] }; }
          };
        }
      };
    },
    insert() {
      return {
        values(values) {
          inserted = values;
          return { onConflictDoUpdate: async () => { operations.push('insert'); } };
        }
      };
    }
  };
}

test('POST refuses a missing bearer token before touching the database', async () => {
  let verifyCalls = 0;
  const handler = historyApi.createHistoryHandler({
    database: { select() { throw new Error('database should not be touched'); } },
    verifyToken: async () => { verifyCalls += 1; return 'uid'; },
    checkRateLimit: async () => 0
  });
  const response = createResponse();

  await handler(createRequest(), response);

  assert.equal(response.statusCode, 401);
  assert.equal(verifyCalls, 0);
});

test('POST rejects an invalid Firebase token without importing data', async () => {
  let importCalls = 0;
  const handler = historyApi.createHistoryHandler({
    database: { select() { throw new Error('database should not be touched'); } },
    verifyToken: async () => null,
    checkRateLimit: async () => 0,
    importDay: async () => { importCalls += 1; return { records: [] }; }
  });
  const response = createResponse();

  await handler(createRequest({ token: 'invalid' }), response);

  assert.equal(response.statusCode, 401);
  assert.equal(importCalls, 0);
});

test('POST rate-limits abusive IPs before verifying tokens', async () => {
  let verifyCalls = 0;
  const handler = historyApi.createHistoryHandler({
    verifyToken: async () => { verifyCalls += 1; return 'uid'; },
    checkRateLimit: async (subject) => subject.startsWith('ip:') ? 3600 : 0
  });
  const response = createResponse();

  await handler(createRequest({ token: 'valid-looking-token' }), response);

  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['Retry-After'], '3600');
  assert.equal(verifyCalls, 0);
});

test('POST rate-limits verified users before calling the TJK importer', async () => {
  let importCalls = 0;
  const handler = historyApi.createHistoryHandler({
    verifyToken: async () => 'firebase-user',
    checkRateLimit: async (subject) => subject.startsWith('user:') ? 1800 : 0,
    importDay: async () => { importCalls += 1; return { records: [] }; }
  });
  const response = createResponse();

  await handler(createRequest({ token: 'valid-looking-token' }), response);

  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['Retry-After'], '1800');
  assert.equal(importCalls, 0);
});

test('POST rejects race dates older than the rolling one-year archive window', async () => {
  const handler = historyApi.createHistoryHandler({
    database: { select() { throw new Error('expired date should be rejected before database access'); } },
    checkRateLimit: async () => 0
  });
  const expiredDate = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const response = createResponse();

  await handler(createRequest({ token: 'token', date: expiredDate }), response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /between/);
});

test('POST rejects malformed JSON before authentication', async () => {
  let verifyCalls = 0;
  const handler = historyApi.createHistoryHandler({
    verifyToken: async () => { verifyCalls += 1; return 'uid'; },
    checkRateLimit: async () => 0
  });
  const response = createResponse();

  await handler(createRequest({ token: 'token', body: '{invalid json' }), response);

  assert.equal(response.statusCode, 400);
  assert.equal(verifyCalls, 0);
});

test('POST imports a valid date only after verified auth and rate checks', async () => {
  const database = createDatabase();
  let importedDate = null;
  const limiterCalls = [];
  const handler = historyApi.createHistoryHandler({
    database,
    verifyToken: async (token) => token === 'valid-token' ? 'firebase-user' : null,
    checkRateLimit: async (subject, limit) => { limiterCalls.push([subject, limit]); return 0; },
    importDay: async (date) => {
      importedDate = date;
      return {
        records: [{
          city: 'Ankara',
          raceNo: 1,
          program: { runners: [{ number: 1 }] },
          results: { runners: [{ number: 1 }] },
          sourceUrls: {}
        }],
        cities: ['Ankara'],
        errors: []
      };
    }
  });
  const date = new Date().toISOString().slice(0, 10);
  const response = createResponse();

  await handler(createRequest({ token: 'valid-token', date }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(importedDate, date);
  assert.equal(database.inserted.length, 1);
  assert.deepEqual(database.operations, ['insert', 'prune']);
  assert.equal(response.body.prunedRecords, 0);
  assert.deepEqual(limiterCalls.map(([subject]) => subject), ['ip:203.0.113.10', 'user:firebase-user', 'global']);
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
