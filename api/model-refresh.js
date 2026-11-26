const { timingSafeEqual } = require('node:crypto');
const { refreshAutomaticModel } = require('../lib/automatic-learning');
const { MODEL_VERSION } = require('../lib/model-version');

function isAuthorized(authorization, secret) {
  if (typeof authorization !== 'string' || typeof secret !== 'string' || !secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createModelRefreshHandler({ refresh = refreshAutomaticModel, getSecret = () => process.env.CRON_SECRET } = {}) {
  return async function modelRefreshHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    if (!getSecret()) return res.status(503).json({ error: 'Scheduled model refresh is not configured.' });
    if (!isAuthorized(req.headers?.authorization, getSecret())) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    try {
      const model = await refresh();
      return res.status(200).json({
        ok: true,
        model: model.model || MODEL_VERSION,
        runId: model.runId,
        refreshedAt: model.refreshedAt,
        report: model.report
      });
    } catch (error) {
      console.error('[model-refresh] Scheduled model refresh failed:', error?.code || 'MODEL_REFRESH_FAILED');
      return res.status(500).json({ error: 'Scheduled model refresh failed.' });
    }
  };
}

module.exports = createModelRefreshHandler();
module.exports.createModelRefreshHandler = createModelRefreshHandler;
module.exports.isAuthorized = isAuthorized;
