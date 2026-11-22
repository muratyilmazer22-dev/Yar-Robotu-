const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleDriveBackupHandler, CONNECTOR_UID, DRIVE_SCOPE, MAX_BACKUP_BYTES, validateBackup } = require('./lib/google-drive-backup');

class UserAuthorizationRequiredError extends Error {
  constructor() {
    super('Authorization required');
    this.name = 'UserAuthorizationRequiredError';
  }
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function createHandler(overrides = {}) {
  const calls = [];
  const defaults = {
    verifyToken: async (token) => token === 'valid' ? 'firebase-uid' : null,
    getToken: async (connector, params) => {
      calls.push(['getToken', connector, params]);
      return 'private-drive-token';
    },
    startAuthorization: async (...args) => {
      calls.push(['startAuthorization', ...args]);
      return { url: 'https://accounts.google.com/consent' };
    },
    UserAuthorizationRequiredError,
    getOrigin: () => 'https://app.example.test',
    fetchImpl: async (url, options = {}) => {
      calls.push(['fetch', String(url), options]);
      if (String(url).includes('/drive/v3/files?')) {
        return { ok: true, json: async () => ({ files: [] }) };
      }
      return { ok: true, json: async () => ({ id: 'drive-file', name: 'Yarış Robotu - Kişisel Yedek.json', modifiedTime: '2026-01-01T00:00:00.000Z' }) };
    }
  };
  return { handler: createGoogleDriveBackupHandler({ ...defaults, ...overrides }), calls };
}

const validBackup = { app: 'yar-robotu', version: 1, createdAt: '2026-01-01T00:00:00.000Z', state: { predictions: [], outcomes: [], coupons: [] } };

async function callHandler(handler, { method = 'POST', authorization = 'Bearer valid', body = { action: 'status' } } = {}) {
  const req = { method, headers: { authorization, host: 'app.example.test' }, body };
  const res = responseRecorder();
  await handler(req, res);
  return res;
}

test('rejects requests without a verified Firebase session', async () => {
  const { handler, calls } = createHandler();
  const res = await callHandler(handler, { authorization: '', body: { action: 'backup', backup: validBackup } });
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
});

test('scopes the Connect subject to the verified Firebase user', async () => {
  const { handler, calls } = createHandler();
  const res = await callHandler(handler);
  assert.deepEqual(res.body, { connected: true });
  assert.equal(calls[0][1], CONNECTOR_UID);
  assert.equal(calls[0][2].subject.id, 'firebase-uid');
  assert.equal(calls[0][2].subject.issuer, 'https://securetoken.google.com/gen-lang-client-0654956769');
  assert.deepEqual(calls[0][2].scopes, [DRIVE_SCOPE]);
});

test('status checks do not start an OAuth flow before the user asks to connect', async () => {
  let authorizationStarts = 0;
  const { handler } = createHandler({
    getToken: async () => { throw new UserAuthorizationRequiredError(); },
    startAuthorization: async () => { authorizationStarts += 1; return { url: 'https://accounts.google.com/consent' }; }
  });
  const res = await callHandler(handler);
  assert.deepEqual(res.body, { connected: false });
  assert.equal(authorizationStarts, 0);
});

test('returns a consent URL only for the authenticated Firebase subject', async () => {
  const { handler, calls } = createHandler({ getToken: async (...args) => { calls.push(['getToken', ...args]); throw new UserAuthorizationRequiredError(); } });
  const res = await callHandler(handler, { body: { action: 'connect' } });
  assert.equal(res.body.authorizationUrl, 'https://accounts.google.com/consent');
  assert.equal(calls[0][1], CONNECTOR_UID);
  assert.equal(calls[0][2].subject.id, 'firebase-uid');
  assert.equal(calls[1][3].callbackUrl, 'https://app.example.test/?drive=connected');
});

test('rejects unsupported methods and oversized or foreign backup payloads', async () => {
  const { handler } = createHandler();
  const methodRes = await callHandler(handler, { method: 'GET' });
  assert.equal(methodRes.statusCode, 405);
  assert.equal(methodRes.headers.Allow, 'POST');
  const invalidRes = await callHandler(handler, { body: { action: 'backup', backup: { ...validBackup, app: 'other' } } });
  assert.equal(invalidRes.statusCode, 400);
  const oversized = { ...validBackup, state: { data: 'x'.repeat(MAX_BACKUP_BYTES) } };
  const oversizedRes = await callHandler(handler, { body: { action: 'backup', backup: oversized } });
  assert.equal(oversizedRes.statusCode, 413);
});

test('creates a user-visible Drive backup with private auth only on the server', async () => {
  const { handler, calls } = createHandler();
  const res = await callHandler(handler, { body: { action: 'backup', backup: validBackup } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  const upload = calls.find(([type, url]) => type === 'fetch' && url.includes('/upload/drive/v3/files'));
  assert.ok(upload);
  assert.match(upload[2].headers.Authorization, /^Bearer private-drive-token$/);
  assert.equal(JSON.stringify(res.body).includes('private-drive-token'), false);
});

test('restores only the application backup from the authenticated Drive subject', async () => {
  const { handler, calls } = createHandler({
    fetchImpl: async (url, options = {}) => {
      calls.push(['fetch', String(url), options]);
      if (String(url).includes('/drive/v3/files?')) {
        return { ok: true, json: async () => ({ files: [{ id: 'drive-file', name: 'Yarış Robotu - Kişisel Yedek.json', modifiedTime: '2026-01-01T00:00:00.000Z' }] }) };
      }
      return { ok: true, json: async () => validBackup };
    }
  });
  const res = await callHandler(handler, { body: { action: 'restore' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.backup, validBackup);
  assert.equal(calls[1][2].headers.Authorization, 'Bearer private-drive-token');
});

test('accepts only this application’s versioned backup format', () => {
  assert.equal(validateBackup(validBackup), true);
  assert.equal(validateBackup({ ...validBackup, app: 'other' }), false);
  assert.equal(validateBackup({ ...validBackup, version: 2 }), false);
  assert.equal(validateBackup(null), false);
});
