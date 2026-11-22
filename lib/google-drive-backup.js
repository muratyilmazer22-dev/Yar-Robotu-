const { randomUUID } = require('node:crypto');

const CONNECTOR_UID = 'google/yar-kuponu-drive-yede-i';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_FILE_NAME = 'Yarış Robotu - Kişisel Yedek.json';
const MAX_BACKUP_BYTES = 4_000_000;

function getRequestOrigin(req) {
  if (process.env.NODE_ENV !== 'production' && process.env.V0_RUNTIME_URL) {
    return process.env.V0_RUNTIME_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  const protocol = req.headers?.['x-forwarded-proto'] || 'https';
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) throw new Error('Request origin is unavailable.');
  return `${protocol === 'http' && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? 'http' : 'https'}://${host}`;
}

function makeTokenParams(userId) {
  return {
    subject: { type: 'user', id: userId, issuer: 'https://securetoken.google.com/gen-lang-client-0654956769' },
    scopes: [DRIVE_SCOPE]
  };
}

function isAuthorizationRequired(error, ErrorType) {
  return (typeof ErrorType === 'function' && error instanceof ErrorType)
    || error?.name === 'UserAuthorizationRequiredError';
}

function jsonResponse(res, status, value) {
  return res.status(status).json(value);
}

function validateBackup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.app !== 'yar-robotu' || value.version !== 1 || !value.state || typeof value.state !== 'object' || Array.isArray(value.state)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_BACKUP_BYTES;
  } catch {
    return false;
  }
}

function driveHeaders(token, contentType) {
  return {
    Authorization: `Bearer ${token}`,
    ...(contentType ? { 'Content-Type': contentType } : {})
  };
}

function createGoogleDriveBackupHandler({
  verifyToken,
  getToken,
  startAuthorization,
  UserAuthorizationRequiredError,
  fetchImpl = fetch,
  getOrigin = getRequestOrigin
}) {
  async function authorize(req, userId, startFlow = true) {
    const params = makeTokenParams(userId);
    try {
      return { token: await getToken(CONNECTOR_UID, params) };
    } catch (error) {
      if (!isAuthorizationRequired(error, UserAuthorizationRequiredError)) throw error;
      if (!startFlow) return { authorizationRequired: true };
      const { url } = await startAuthorization(CONNECTOR_UID, params, {
        callbackUrl: `${getOrigin(req)}/?drive=connected`
      });
      return { authorizationUrl: url };
    }
  }

  async function findBackup(token) {
    const query = `name = '${BACKUP_FILE_NAME.replaceAll("'", "\\'")}' and trashed = false`;
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', query);
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('pageSize', '10');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime)');
    const response = await fetchImpl(url, { headers: driveHeaders(token) });
    if (!response.ok) throw new Error('Google Drive file lookup failed.');
    const result = await response.json();
    return Array.isArray(result.files) ? result.files.find((file) => file?.id && file.name === BACKUP_FILE_NAME) || null : null;
  }

  async function writeBackup(token, backup, file) {
    const payload = JSON.stringify(backup);
    let response;
    if (file) {
      const url = new URL(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(file.id)}`);
      url.searchParams.set('uploadType', 'media');
      url.searchParams.set('fields', 'id,name,modifiedTime');
      response = await fetchImpl(url, {
        method: 'PATCH',
        headers: driveHeaders(token, 'application/json; charset=utf-8'),
        body: payload
      });
    } else {
      const boundary = `yarrobotu_${randomUUID().replaceAll('-', '')}`;
      const metadata = JSON.stringify({ name: BACKUP_FILE_NAME, mimeType: 'application/json' });
      const body = [
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}`,
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${payload}`,
        `--${boundary}--\r\n`
      ].join('\r\n');
      const url = new URL('https://www.googleapis.com/upload/drive/v3/files');
      url.searchParams.set('uploadType', 'multipart');
      url.searchParams.set('fields', 'id,name,modifiedTime');
      response = await fetchImpl(url, {
        method: 'POST',
        headers: driveHeaders(token, `multipart/related; boundary=${boundary}`),
        body
      });
    }
    if (!response.ok) throw new Error('Google Drive backup write failed.');
    return response.json();
  }

  async function readBackup(token, file) {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`);
    url.searchParams.set('alt', 'media');
    const response = await fetchImpl(url, { headers: driveHeaders(token) });
    if (!response.ok) throw new Error('Google Drive backup read failed.');
    const value = await response.json();
    if (!validateBackup(value)) throw new Error('Google Drive backup format is invalid.');
    return value;
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return jsonResponse(res, 405, { error: 'Method not allowed.' });
    }

    const authorization = req.headers?.authorization || '';
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!idToken || idToken.length > 8192) return jsonResponse(res, 401, { error: 'Firebase sign-in is required.' });
    const userId = await verifyToken(idToken);
    if (!userId) return jsonResponse(res, 401, { error: 'Firebase session is invalid or expired.' });

    const action = req.body?.action;
    if (!['connect', 'status', 'backup', 'restore'].includes(action)) {
      return jsonResponse(res, 400, { error: 'Unsupported Drive action.' });
    }
    if (action === 'backup' && !validateBackup(req.body?.backup)) {
      return jsonResponse(res, Buffer.byteLength(JSON.stringify(req.body?.backup ?? null), 'utf8') > MAX_BACKUP_BYTES ? 413 : 400, {
        error: 'Backup data is invalid or exceeds the 4 MB limit.'
      });
    }

    let access;
    try {
      access = await authorize(req, userId, action !== 'status');
    } catch {
      return jsonResponse(res, 502, { error: 'Google Drive authorization could not be checked. Try again shortly.' });
    }
    if (access.authorizationRequired) return jsonResponse(res, 200, { connected: false });
    if (access.authorizationUrl) return jsonResponse(res, 200, { connected: false, authorizationUrl: access.authorizationUrl });
    if (action === 'connect' || action === 'status') return jsonResponse(res, 200, { connected: true });

    try {
      const file = await findBackup(access.token);
      if (action === 'restore') {
        if (!file) return jsonResponse(res, 404, { error: 'Google Drive’da henüz bir yedek bulunamadı.' });
        const backup = await readBackup(access.token, file);
        return jsonResponse(res, 200, { ok: true, backup, modifiedTime: file.modifiedTime || null });
      }
      const saved = await writeBackup(access.token, req.body.backup, file);
      return jsonResponse(res, 200, {
        ok: true,
        fileName: BACKUP_FILE_NAME,
        modifiedTime: saved.modifiedTime || new Date().toISOString()
      });
    } catch {
      return jsonResponse(res, 502, { error: 'Google Drive işlemi başarısız oldu. Bağlantıyı ve Drive erişimini kontrol edip yeniden deneyin.' });
    }
  };
}

module.exports = {
  BACKUP_FILE_NAME,
  CONNECTOR_UID,
  DRIVE_SCOPE,
  MAX_BACKUP_BYTES,
  createGoogleDriveBackupHandler,
  makeTokenParams,
  validateBackup
};
