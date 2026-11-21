const { pgTable, date, text, smallint, jsonb, timestamp, primaryKey } = require('drizzle-orm/pg-core');

const raceHistory = pgTable('race_history', {
  raceDate: date('race_date', { mode: 'string' }).notNull(),
  city: text('city').notNull(),
  raceNo: smallint('race_no').notNull(),
  program: jsonb('program').notNull().default([]),
  results: jsonb('results').notNull().default([]),
  sourceUrls: jsonb('source_urls').notNull().default({}),
  importedAt: timestamp('imported_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
}, (table) => ({
  pk: primaryKey({ columns: [table.raceDate, table.city, table.raceNo] })
}));

module.exports = { raceHistory };
