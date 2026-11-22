const { pgTable, date, text, smallint, jsonb, timestamp, integer, primaryKey, index } = require('drizzle-orm/pg-core');

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

const historyImportRateLimits = pgTable('history_import_rate_limits', {
  subjectHash: text('subject_hash').primaryKey(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  requestCount: integer('request_count').notNull().default(1)
}, (table) => ({
  windowStartedAtIdx: index('history_import_rate_limits_window_started_at_idx').on(table.windowStartedAt)
}));

module.exports = { raceHistory, robotMemory, historyImportRateLimits };
