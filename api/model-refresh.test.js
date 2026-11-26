const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelRefreshHandler, isAuthorized } = require('./model-refresh');

function response() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test('cron authorization compares the full bearer token safely', () => {
  assert.equal(isAuthorized('Bearer test-secret', 'test-secret'), true);
  assert.equal(isAuthorized('Bearer wrong-secret', 'test-secret'), false);
  assert.equal(isAuthorized('test-secret', 'test-secret'), false);
  assert.equal(isAuthorized('Bearer test-secret', ''), false);
});

test('model refresh endpoint rejects unauthenticated requests without starting a run', async () => {
  let called = false;
  const handler = createModelRefreshHandler({ refresh: async () => { called = true; }, getSecret: () => 'test-secret' });
  const res = response();

  await handler({ method: 'GET', headers: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});

test('model refresh endpoint returns a traceable run result for authorized cron requests', async () => {
  const handler = createModelRefreshHandler({
    refresh: async () => ({ model: 'model-v7', runId: 42, refreshedAt: '2026-11-25T04:00:00.000Z', report: { updated: false } }),
    getSecret: () => 'test-secret'
  });
  const res = response();

  await handler({ method: 'GET', headers: { authorization: 'Bearer test-secret' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.runId, 42);
  assert.equal(res.body.model, 'model-v7');
});

test('model refresh endpoint rejects methods other than GET', async () => {
  const handler = createModelRefreshHandler({ getSecret: () => 'test-secret' });
  const res = response();

  await handler({ method: 'POST', headers: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});
