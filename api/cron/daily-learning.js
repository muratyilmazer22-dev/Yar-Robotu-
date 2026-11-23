const { timingSafeEqual } = require('node:crypto');
const { runDailyLearning } = require('../../lib/automatic-learning');

function secretsMatch(expected, supplied) {
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function createDailyLearningHandler({ secret = () => process.env.CRON_SECRET, run = runDailyLearning } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'Method not allowed.' });
    }
    const configuredSecret = secret();
    if (!configuredSecret) return response.status(503).json({ error: 'Scheduled learning is not configured.' });
    const authorization = request.headers?.authorization || '';
    const suppliedSecret = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
    if (!secretsMatch(configuredSecret, suppliedSecret)) return response.status(401).json({ error: 'Unauthorized.' });

    try {
      const result = await run();
      return response.status(200).json({ ok: true, ...result });
    } catch {
      return response.status(502).json({ error: 'Scheduled TJK import or model evaluation failed.' });
    }
  };
}

module.exports = createDailyLearningHandler();
module.exports.createDailyLearningHandler = createDailyLearningHandler;
