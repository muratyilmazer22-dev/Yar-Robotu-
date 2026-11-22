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

const robotMemory = pgTable('robot_memory', {
  memoryKey: text('memory_key').primaryKey(),
  memoryValue: jsonb('memory_value').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

module.exports = { raceHistory, robotMemory };
