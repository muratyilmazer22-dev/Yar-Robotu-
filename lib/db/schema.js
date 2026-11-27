const { pgTable, date, text, smallint, jsonb, timestamp, integer, bigint, boolean, uuid, primaryKey, index } = require('drizzle-orm/pg-core');

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

const raceHistoryAudit = pgTable('race_history_audit', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  raceDate: date('race_date', { mode: 'string' }).notNull(),
  city: text('city').notNull(),
  raceNo: smallint('race_no').notNull(),
  eventType: text('event_type').notNull(),
  beforeSnapshot: jsonb('before_snapshot'),
  afterSnapshot: jsonb('after_snapshot'),
  details: jsonb('details').notNull().default({}),
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

const shadowRaceSignals = pgTable('shadow_race_signals', {
  signalId: text('signal_id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  raceDate: date('race_date', { mode: 'string' }).notNull(),
  city: text('city').notNull(),
  raceNo: smallint('race_no').notNull(),
  sourcePublishedAt: timestamp('source_published_at', { withTimezone: true, mode: 'date' }),
  publishedBeforeRace: boolean('published_before_race').notNull().default(false),
  signals: jsonb('signals').notNull().default({}),
  sourceNote: text('source_note').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

const bulletinFictionDocuments = pgTable('bulletin_fiction_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  sourceText: text('source_text').notNull().default(''),
  outlineText: text('outline_text').notNull().default(''),
  draftText: text('draft_text').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
}, (table) => ({
  ownerUpdatedIdx: index('bulletin_fiction_documents_owner_updated_idx').on(table.ownerId, table.updatedAt)
}));

const modelTrainingRuns = pgTable('model_training_runs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  modelVersion: text('model_version').notNull(),
  trainedAt: timestamp('trained_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  trainingFrom: date('training_from', { mode: 'string' }),
  trainingTo: date('training_to', { mode: 'string' }),
  validationFrom: date('validation_from', { mode: 'string' }),
  validationTo: date('validation_to', { mode: 'string' }),
  holdoutFrom: date('holdout_from', { mode: 'string' }),
  holdoutTo: date('holdout_to', { mode: 'string' }),
  sampleCounts: jsonb('sample_counts').notNull().default({}),
  metrics: jsonb('metrics').notNull().default({}),
  weights: jsonb('weights').notNull().default({}),
  accepted: boolean('accepted').notNull().default(false)
});

module.exports = { raceHistory, robotMemory, historyImportRateLimits, raceHistoryAudit, bulletinFictionDocuments, modelTrainingRuns, shadowRaceSignals };
