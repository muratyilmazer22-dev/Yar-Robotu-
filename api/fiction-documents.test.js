const test = require('node:test');
const assert = require('node:assert/strict');
const { createFictionDocumentsHandler, validateDocument } = require('./fiction-documents');

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

const validDocument = {
  title: 'Kıyıdaki not',
  sourceText: 'Kaynak bülten',
  outlineText: 'Olay örgüsü',
  draftText: 'Kurgu taslağı'
};

function fakeDatabase({ inserted = [], updated = [], deleted = [] } = {}) {
  return {
    insert() {
      return { values(value) { inserted.push(value); return { returning: async () => [{ id: 'b6997b3e-5d46-49fa-973e-7cb8c71896c7', ...value }] }; } };
    },
    update() {
      return { set(value) { return { where() { updated.push(value); return { returning: async () => [{ id: 'b6997b3e-5d46-49fa-973e-7cb8c71896c7', ...value }] }; } }; } };
    },
    delete() {
      return { where() { deleted.push(true); return { returning: async () => [{ id: 'b6997b3e-5d46-49fa-973e-7cb8c71896c7' }] }; } };
    },
    select() {
      return { from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) };
    }
  };
}

test('document validation rejects empty and oversized titles and text', () => {
  assert.match(validateDocument({ ...validDocument, title: ' ' }).error, /Başlık/);
  assert.match(validateDocument({ ...validDocument, title: 'x'.repeat(121) }).error, /Başlık/);
  assert.match(validateDocument({ ...validDocument, draftText: 'x'.repeat(40001) }).error, /40.000/);
  assert.deepEqual(validateDocument(validDocument).value, validDocument);
});

test('all document operations require a verified account before database access', async () => {
  let databaseAccessed = false;
  const handler = createFictionDocumentsHandler({
    database: { select() { databaseAccessed = true; } },
    verifyToken: async () => null
  });
  const response = responseStub();

  await handler({ method: 'GET', headers: {} }, response);

  assert.equal(response.statusCode, 401);
  assert.equal(databaseAccessed, false);
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('creating a draft scopes it to the verified Firebase user', async () => {
  const inserted = [];
  const handler = createFictionDocumentsHandler({ database: fakeDatabase({ inserted }), verifyToken: async (token) => token === 'valid-token' ? 'firebase-user-1' : null });
  const response = responseStub();

  await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: validDocument }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].ownerId, 'firebase-user-1');
  assert.equal(inserted[0].draftText, validDocument.draftText);
});

test('saving and deleting a draft accepts only a well-formed document id', async () => {
  const updated = [];
  const deleted = [];
  const handler = createFictionDocumentsHandler({ database: fakeDatabase({ updated, deleted }), verifyToken: async () => 'firebase-user-1' });
  const badResponse = responseStub();
  await handler({ method: 'PUT', headers: { authorization: 'Bearer valid' }, body: { ...validDocument, id: 'not-an-id' } }, badResponse);
  assert.equal(badResponse.statusCode, 400);
  assert.equal(updated.length, 0);

  const goodResponse = responseStub();
  await handler({ method: 'PUT', headers: { authorization: 'Bearer valid' }, body: { ...validDocument, id: 'b6997b3e-5d46-49fa-973e-7cb8c71896c7' } }, goodResponse);
  assert.equal(goodResponse.statusCode, 200);
  assert.equal(updated.length, 1);

  const deleteResponse = responseStub();
  await handler({ method: 'DELETE', headers: { authorization: 'Bearer valid' }, query: { id: 'b6997b3e-5d46-49fa-973e-7cb8c71896c7' } }, deleteResponse);
  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deleted.length, 1);
});
