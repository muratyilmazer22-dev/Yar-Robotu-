const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const schema = require('./schema');
const { secureDatabaseConnectionString } = require('./connection-string');

const databaseUrl = process.env.SUPABASE_POSTGRES_URL_NON_POOLING
  || process.env.SUPABASE_POSTGRES_URL
  || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('A PostgreSQL connection URL is not configured.');
}

const globalForDatabase = globalThis;
const pool = globalForDatabase.raceRobotPool || new Pool({
  connectionString: secureDatabaseConnectionString(databaseUrl),
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
});

if (process.env.NODE_ENV !== 'production') globalForDatabase.raceRobotPool = pool;

const db = drizzle(pool, { schema });

module.exports = { db, pool };
