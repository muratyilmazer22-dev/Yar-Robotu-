const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
const { secureDatabaseConnectionString } = require("../lib/db/connection-string");
const { and, asc, desc, eq, sql } = require("drizzle-orm");
const { date, jsonb, pgTable, smallint, text } = require("drizzle-orm/pg-core");

const raceHistory = pgTable("race_history", {
  city: text("city"),
  raceDate: date("race_date", { mode: "string" }),
  raceNo: smallint("race_no"),
  program: jsonb("program"),
  results: jsonb("results")
});

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.DATABASE_URL) {
    return response.status(503).json({ error: "Historical archive is not configured" });
  }

  const pool = new Pool({ connectionString: secureDatabaseConnectionString(process.env.DATABASE_URL), max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000 });
  try {
    const db = drizzle(pool);
    const today = new Date().toISOString().slice(0, 10);
    const date = request.query?.date;
    const city = request.query?.city;
    if (date !== undefined && (!isIsoDate(date) || date > today)) {
      return response.status(400).json({ error: "Choose a valid archived race date that is not in the future." });
    }
    if (city !== undefined && (typeof city !== "string" || !city.trim() || city.length > 80 || date === undefined)) {
      return response.status(400).json({ error: "A valid date is required when filtering by city." });
    }
    const conditions = [];
    if (date) conditions.push(eq(raceHistory.raceDate, date));
    if (city) conditions.push(sql`lower(${raceHistory.city}) = lower(${city.trim()})`);
    const limit = Math.min(5000, Math.max(1, Number.parseInt(request.query?.limit, 10) || 5000));
    const offset = Math.max(0, Number.parseInt(request.query?.offset, 10) || 0);
    let query = db.select({
      city: raceHistory.city,
      race_date: raceHistory.raceDate,
      race_no: raceHistory.raceNo,
      program: raceHistory.program,
      results: raceHistory.results
    }).from(raceHistory);
    if (conditions.length) query = query.where(and(...conditions));
    const races = await query
      .orderBy(desc(raceHistory.raceDate), asc(raceHistory.city), asc(raceHistory.raceNo))
      .limit(limit)
      .offset(offset);
    response.setHeader("Cache-Control", date ? "public, max-age=300, s-maxage=300" : "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400");
    return response.status(200).json(races);
  } catch {
    return response.status(503).json({ error: "Historical archive is temporarily unavailable" });
  } finally {
    await pool.end().catch(() => {});
  }
};
