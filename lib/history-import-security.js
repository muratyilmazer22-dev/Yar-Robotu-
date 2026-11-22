const { createHash } = require('node:crypto');

const WINDOW_MS = 60 * 60 * 1000;

function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'] || req.headers?.['x-vercel-forwarded-for'];
  const candidates = typeof forwarded === 'string' ? forwarded.split(',') : [];
  return candidates.at(-1)?.trim() || req.socket?.remoteAddress || 'unknown';
}

async function verifyFirebaseIdToken(idToken) {
  const apiKey = process.env.apiKey;
  if (!apiKey || typeof idToken !== 'string' || idToken.length > 8192) return null;

  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const result = await response.json();
    const userId = result?.users?.[0]?.localId;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
  } catch {
    return null;
  }
}

function createHistoryRateLimiter(pool) {
  let lastCleanupAt = 0;
  return async function checkRateLimit(subject, limit) {
    if (Date.now() - lastCleanupAt > 30 * 60 * 1000) {
      lastCleanupAt = Date.now();
      await pool.query("DELETE FROM public.history_import_rate_limits WHERE window_started_at < now() - interval '2 days'").catch(() => {});
    }
    const subjectHash = createHash('sha256').update(String(subject)).digest('hex');
    const result = await pool.query(`
      INSERT INTO public.history_import_rate_limits AS rate_limits (subject_hash, window_started_at, request_count)
      VALUES ($1, now(), 1)
      ON CONFLICT (subject_hash) DO UPDATE SET
        request_count = CASE
          WHEN rate_limits.window_started_at <= now() - interval '1 hour' THEN 1
          ELSE rate_limits.request_count + 1
        END,
        window_started_at = CASE
          WHEN rate_limits.window_started_at <= now() - interval '1 hour' THEN now()
          ELSE rate_limits.window_started_at
        END
      RETURNING request_count, window_started_at
    `, [subjectHash]);

    const row = result.rows[0];
    if (Number(row.request_count) <= limit) return 0;
    const windowEndsAt = new Date(row.window_started_at).getTime() + WINDOW_MS;
    return Math.max(1, Math.ceil((windowEndsAt - Date.now()) / 1000));
  };
}

module.exports = { createHistoryRateLimiter, getClientIp, verifyFirebaseIdToken };
