const test = require('node:test');
const assert = require('node:assert/strict');
const { createPrivateResultImageHandler } = require('./lib/private-result-images');

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; }
  };
}

const jpegDataUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64')}`;

 test('requires a valid Firebase bearer token before reading or writing', async () => {
  const handler = createPrivateResultImageHandler({ verifyToken: async () => null });
  const res = response();
  await handler({ method: 'POST', headers: {}, body: { image: jpegDataUrl } }, res);
  assert.equal(res.statusCode, 401);
});

test('stores a validated JPEG as a private, user-scoped Blob', async () => {
  let stored;
  const handler = createPrivateResultImageHandler({
    verifyToken: async (token) => token === 'valid' ? 'user-123' : null,
    putBlob: async (pathname, image, options) => {
      stored = { pathname, image, options };
      return { pathname };
    }
  });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid' }, body: { image: jpegDataUrl } }, res);
  assert.equal(res.statusCode, 201);
  assert.match(stored.pathname, /^users\/user-123\/results\/.+\.jpg$/);
  assert.equal(stored.options.access, 'private');
  assert.equal(stored.options.contentType, 'image/jpeg');
});

test('prevents users from reading another user’s private image', async () => {
  const handler = createPrivateResultImageHandler({
    verifyToken: async () => 'user-123',
    getBlob: async () => { throw new Error('must not be called'); }
  });
  const res = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer valid' }, query: { pathname: 'users/other-user/results/file.jpg' } }, res);
  assert.equal(res.statusCode, 404);
});

test('rejects malformed image payloads', async () => {
  const handler = createPrivateResultImageHandler({ verifyToken: async () => 'user-123' });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer valid' }, body: { image: 'data:image/jpeg;base64,AAAA' } }, res);
  assert.equal(res.statusCode, 400);
});
