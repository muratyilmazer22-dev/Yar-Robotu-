const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("./result-image-ocr");

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("result image OCR rejects unsupported methods", async () => {
  const res = createResponse();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
});

test("result image OCR requires JSON", async () => {
  const res = createResponse();
  await handler({ method: "POST", headers: { "content-type": "text/plain" }, body: {} }, res);
  assert.equal(res.statusCode, 415);
});

test("result image OCR rejects invalid data URLs before calling a model", async () => {
  const res = createResponse();
  await handler({ method: "POST", headers: { "content-type": "application/json" }, body: { image: "data:image/gif;base64,R0lGODlh" } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /JPG, PNG veya WebP/);
});

test("result image OCR verifies image signatures", async () => {
  const res = createResponse();
  await handler({ method: "POST", headers: { "content-type": "application/json" }, body: { image: `data:image/jpeg;base64,${Buffer.from("not an image").toString("base64")}` } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Görsel biçimi doğrulanamadı/);
});
