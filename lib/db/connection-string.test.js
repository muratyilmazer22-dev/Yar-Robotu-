const test = require("node:test");
const assert = require("node:assert/strict");
const { secureDatabaseConnectionString } = require("./connection-string");

test("enforces full certificate and hostname verification for PostgreSQL", () => {
  const connectionString = secureDatabaseConnectionString("postgres://user:pass@db.example.test/app?sslmode=require&application_name=race-robot");
  const connectionUrl = new URL(connectionString);

  assert.equal(connectionUrl.searchParams.get("sslmode"), "verify-full");
  assert.equal(connectionUrl.searchParams.get("application_name"), "race-robot");
  assert.equal(connectionUrl.username, "user");
  assert.equal(connectionUrl.password, "pass");
});

test("rejects non-PostgreSQL connection URLs", () => {
  assert.throws(
    () => secureDatabaseConnectionString("https://db.example.test/app"),
    /postgres or postgresql protocol/
  );
});
