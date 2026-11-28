const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelMemoryHandler } = require('./api/model-memory');
const { robotMemory, raceHistory, modelTrainingRuns } = require('./lib/db/schema');
const { MODEL_VERSION } = require('./lib/model-version');

test('model memory GET returns the current snapshot without writing to the database', async () => {
  const archive = {
    raceCount: 12,
    completedRaceCount: 10,
    firstDate: '2026-01-01',
    lastDate: '2026-01-12'
  };
  const automaticModel = { model: MODEL_VERSION, weights: { form: 1 } };
  const trainingRuns = [{ id: 3, modelVersion: MODEL_VERSION, accepted: true }];
  let queryIndex = 0;
  let writes = 0;
  const database = {
    select() {
      const currentQuery = queryIndex++;
      return {
        from(table) {
          if (currentQuery === 0) {
            assert.equal(table, raceHistory);
            return Promise.resolve([archive]);
          }
          if (currentQuery === 1) {
            assert.equal(table, robotMemory);
            return {
              where: () => ({
                limit: async (limit) => {
                  assert.equal(limit, 1);
                  return [{ memoryValue: automaticModel }];
                }
              })
            };
          }
          assert.equal(currentQuery, 2);
          assert.equal(table, modelTrainingRuns);
          return {
            where: () => ({
              orderBy: () => ({
                limit: async (limit) => {
                  assert.equal(limit, 5);
                  return trainingRuns;
                }
              })
            })
          };
        }
      };
    },
    insert() {
      writes += 1;
      throw new Error('GET must not write');
    }
  };
  const response = {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; }
  };

  await createModelMemoryHandler({ database })({ method: 'GET' }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.body.raceCount, 12);
  assert.equal(response.body.automaticModel, automaticModel);
  assert.equal(response.body.model, MODEL_VERSION);
  assert.deepEqual(response.body.recentTrainingRuns, trainingRuns);
  assert.equal(writes, 0);
});
