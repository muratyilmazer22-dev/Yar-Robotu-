const { verifyFirebaseIdToken } = require('../lib/history-import-security');
const { createPrivateResultImageHandler } = require('../lib/private-result-images');

let handlerPromise;

module.exports = async function handler(req, res) {
  if (!handlerPromise) {
    handlerPromise = import('@vercel/blob').then(({ get, put }) => createPrivateResultImageHandler({
      verifyToken: verifyFirebaseIdToken,
      getBlob: get,
      putBlob: put
    }));
  }

  try {
    return await (await handlerPromise)(req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'Görsel depolama hizmeti şu anda kullanılamıyor.' });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '700kb' } } };
