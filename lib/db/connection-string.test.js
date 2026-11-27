const test = require("node:test");
const assert = require("node:assert/strict");
const { getDatabaseUrl, secureDatabaseConnectionString } = require("./connection-string");

test("prefers the configured primary database URL over compatibility fallbacks", () => {
  assert.equal(getDatabaseUrl({
    DATABASE_URL: "postgres://neon.example.test/app",
    SUPABASE_POSTGRES_URL_NON_POOLING: "postgres://supabase-direct.example.test/app",
    SUPABASE_POSTGRES_URL: "postgres://supabase-pooler.example.test/app"
  }), "postgres://neon.example.test/app");
  assert.equal(getDatabaseUrl({
    SUPABASE_POSTGRES_URL_NON_POOLING: "postgres://supabase-direct.example.test/app",
    SUPABASE_POSTGRES_URL: "postgres://supabase-pooler.example.test/app"
  }), "postgres://supabase-direct.example.test/app");
  assert.equal(getDatabaseUrl({ SUPABASE_POSTGRES_URL: "postgres://supabase-pooler.example.test/app" }), "postgres://supabase-pooler.example.test/app");
});

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
