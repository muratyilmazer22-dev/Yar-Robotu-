const { randomUUID } = require('node:crypto');

const MAX_IMAGE_BYTES = 450 * 1024;
const DATA_URL_PATTERN = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function bearerToken(req) {
  const authorization = req.headers?.authorization;
  return typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';
}

function createPrivateResultImageHandler({ verifyToken, getBlob, putBlob }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const userId = await verifyToken(bearerToken(req));
    if (!userId) return res.status(401).json({ error: 'Oturum açmanız gerekiyor.' });

    if (req.method === 'POST') {
      const match = DATA_URL_PATTERN.exec(req.body?.image || '');
      if (!match || match[1].length % 4 !== 0 || match[1].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
        return res.status(400).json({ error: 'Yalnızca 450 KB’a kadar JPEG görsel yüklenebilir.' });
      }
      const image = Buffer.from(match[1], 'base64');
      if (image.length > MAX_IMAGE_BYTES || !isJpeg(image)) {
        return res.status(400).json({ error: 'Görsel biçimi doğrulanamadı veya dosya sınırı aşıldı.' });
      }

      const pathname = `users/${userId}/results/${randomUUID()}.jpg`;
      const blob = await putBlob(pathname, image, {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'image/jpeg'
      });
      return res.status(201).json({ pathname: blob.pathname });
    }

    if (req.method === 'GET') {
      const pathname = req.query?.pathname;
      if (typeof pathname !== 'string' || pathname.length > 500 || !pathname.startsWith(`users/${userId}/results/`) || !/^users\/[A-Za-z0-9_-]+\/results\/[A-Za-z0-9-]+\.jpg$/.test(pathname)) {
        return res.status(404).json({ error: 'Görsel bulunamadı.' });
      }
      const result = await getBlob(pathname, { access: 'private' });
      if (!result) return res.status(404).json({ error: 'Görsel bulunamadı.' });
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('ETag', result.blob.etag);
      const stream = result.stream?.pipe ? result.stream : require('node:stream').Readable.fromWeb(result.stream);
      stream.pipe(res.status(200));
      return res;
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Yalnızca GET ve POST istekleri kabul edilir.' });
  };
}

module.exports = { createPrivateResultImageHandler, MAX_IMAGE_BYTES };
