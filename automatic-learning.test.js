const test = require('node:test');
const assert = require('node:assert/strict');
const { BASE_WEIGHTS, dateInTurkey, fitModel, raceToTrainingExample } = require('./lib/automatic-learning');
const cronHandler = require('./api/cron/daily-learning');

function response() {
  return { statusCode: 200, headers: {}, body: null, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}

test('daily automation handler rejects requests without the configured cron secret', async () => {
  let calls = 0;
  const handler = cronHandler.createDailyLearningHandler({ secret: () => 'private-secret', run: async () => { calls += 1; } });
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls, 0);
});

test('daily automation handler runs only for an authorized GET request', async () => {
  const handler = cronHandler.createDailyLearningHandler({ secret: () => 'private-secret', run: async () => ({ imported: { records: 3 } }) });
  const res = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer private-secret' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, imported: { records: 3 } });
});

test('Turkey-local date conversion honors the configured race day timezone', () => {
  assert.deepEqual(dateInTurkey(new Date('2026-11-22T22:30:00.000Z')), { year: '2026', month: '11', day: '23' });
});

test('ambiguous, missing-winner, and unmatched race results are excluded from training', () => {
  const base = { raceDate: '2026-11-22', program: { runners: [{ no: 1 }, { no: 2 }] }, results: { runners: [{ no: 3, finishPosition: 1 }] } };
  assert.equal(raceToTrainingExample(base), null);
  assert.equal(raceToTrainingExample({ ...base, results: { runners: [{ no: 1, finishPosition: 1 }, { no: 2, finishPosition: 1 }] } }), null);
});

test('model fitter preserves trusted weights until it has a forward validation sample', () => {
  const protectedWeights = { ...BASE_WEIGHTS, market: 0.4 };
  const report = fitModel([], protectedWeights);
  assert.equal(report.verified, false);
  assert.deepEqual(report.weights, protectedWeights);
});
