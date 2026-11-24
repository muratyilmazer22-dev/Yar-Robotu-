const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const schema = require('./schema');
const { secureDatabaseConnectionString } = require('./connection-string');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured for the Neon database.');
}

const globalForDatabase = globalThis;
const pool = globalForDatabase.raceRobotPool || new Pool({
  connectionString: secureDatabaseConnectionString(process.env.DATABASE_URL),
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
});

if (process.env.NODE_ENV !== 'production') globalForDatabase.raceRobotPool = pool;

const db = drizzle(pool, { schema });

module.exports = { db, pool };
