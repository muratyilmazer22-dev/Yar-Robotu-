const { verifyFirebaseIdToken } = require('../lib/history-import-security');
const { createGoogleDriveBackupHandler } = require('../lib/google-drive-backup');

let handlerPromise;

module.exports = async function handler(req, res) {
  if (!handlerPromise) {
    handlerPromise = import('@vercel/connect').then((connect) => createGoogleDriveBackupHandler({
      verifyToken: verifyFirebaseIdToken,
      getToken: connect.getToken,
      startAuthorization: connect.startAuthorization,
      UserAuthorizationRequiredError: connect.UserAuthorizationRequiredError
    }));
  }

  try {
    return await (await handlerPromise)(req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Google Drive service is temporarily unavailable.' });
  }
};
