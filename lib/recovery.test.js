const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecoveryFetch } = require('./recovery');

function response(status) {
  return new Response('', { status });
}

test('retries transient GET responses and returns the successful response', async () => {
  let calls = 0;
  const waits = [];
  const fetch = createRecoveryFetch({
    fetchImpl: async () => (++calls === 1 ? response(503) : response(200)),
    wait: async (ms) => waits.push(ms),
    baseDelayMs: 10
  });

  const result = await fetch('/api/model-memory');
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [10]);
});

test('retries temporary network failures a bounded number of times', async () => {
  let calls = 0;
  const fetch = createRecoveryFetch({
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('network unavailable');
      return response(200);
    },
    wait: async () => {}
  });

  assert.equal((await fetch('/api/history/')).status, 200);
  assert.equal(calls, 3);
});

test('does not retry mutations or non-transient client errors', async () => {
  let calls = 0;
  const fetch = createRecoveryFetch({
    fetchImpl: async () => { calls += 1; return response(400); },
    wait: async () => {}
  });

  assert.equal((await fetch('/api/history/', { method: 'POST' })).status, 400);
  assert.equal((await fetch('/api/history/')).status, 400);
  assert.equal(calls, 2);
});

test('returns the last transient response after the retry limit', async () => {
  let calls = 0;
  const fetch = createRecoveryFetch({
    fetchImpl: async () => { calls += 1; return response(503); },
    wait: async () => {},
    maxRetries: 20
  });

  assert.equal((await fetch('/api/race-history')).status, 503);
  assert.equal(calls, 3);
});

test('does not retry cancelled requests', async () => {
  let calls = 0;
  const fetch = createRecoveryFetch({
    fetchImpl: async () => {
      calls += 1;
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    },
    wait: async () => {}
  });

  await assert.rejects(fetch('/api/history/'), { name: 'AbortError' });
  assert.equal(calls, 1);
});
