const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
const { asc, desc, gte } = require("drizzle-orm");
const { date, jsonb, pgTable, smallint, text } = require("drizzle-orm/pg-core");

const raceHistory = pgTable("race_history", {
  city: text("city"),
  raceDate: date("race_date", { mode: "string" }),
  raceNo: smallint("race_no"),
  program: jsonb("program"),
  results: jsonb("results")
});

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.DATABASE_URL) {
    return response.status(503).json({ error: "Historical archive is not configured" });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000 });
  try {
    const db = drizzle(pool);
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const limit = Math.min(5000, Math.max(1, Number.parseInt(request.query?.limit, 10) || 5000));
    const offset = Math.max(0, Number.parseInt(request.query?.offset, 10) || 0);
    const races = await db.select({
      city: raceHistory.city,
      race_date: raceHistory.raceDate,
      race_no: raceHistory.raceNo,
      program: raceHistory.program,
      results: raceHistory.results
    }).from(raceHistory)
      .where(gte(raceHistory.raceDate, cutoff))
      .orderBy(desc(raceHistory.raceDate), asc(raceHistory.city), asc(raceHistory.raceNo))
      .limit(limit)
      .offset(offset);
    response.setHeader("Cache-Control", "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400");
    return response.status(200).json(races);
  } catch {
    return response.status(503).json({ error: "Historical archive is temporarily unavailable" });
  } finally {
    await pool.end().catch(() => {});
  }
};
