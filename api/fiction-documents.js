const { and, desc, eq } = require('drizzle-orm');
const { bulletinFictionDocuments } = require('../lib/db/schema');
const { verifyFirebaseIdToken } = require('../lib/history-import-security');

const MAX_TEXT_LENGTH = 40000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getBearerToken(request) {
  const authorization = request.headers?.authorization || request.headers?.Authorization;
  return typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';
}

function validateDocument(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const sourceText = typeof body?.sourceText === 'string' ? body.sourceText : '';
  const outlineText = typeof body?.outlineText === 'string' ? body.outlineText : '';
  const draftText = typeof body?.draftText === 'string' ? body.draftText : '';
  if (!title || title.length > 120) return { error: 'Başlık 1–120 karakter arasında olmalı.' };
  if ([sourceText, outlineText, draftText].some((value) => value.length > MAX_TEXT_LENGTH)) {
    return { error: 'Her metin alanı en fazla 40.000 karakter olabilir.' };
  }
  return { value: { title, sourceText, outlineText, draftText } };
}

function createFictionDocumentsHandler({ database, verifyToken = verifyFirebaseIdToken } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST, PUT, DELETE');
      return response.status(405).json({ error: 'Bu işlem desteklenmiyor.' });
    }

    const ownerId = await verifyToken(getBearerToken(request));
    if (!ownerId) return response.status(401).json({ error: 'Taslaklarınıza erişmek için giriş yapın.' });

    const activeDatabase = database || require('../lib/db').db;
    try {
      if (request.method === 'GET') {
        const documents = await activeDatabase.select({
          id: bulletinFictionDocuments.id,
          title: bulletinFictionDocuments.title,
          sourceText: bulletinFictionDocuments.sourceText,
          outlineText: bulletinFictionDocuments.outlineText,
          draftText: bulletinFictionDocuments.draftText,
          createdAt: bulletinFictionDocuments.createdAt,
          updatedAt: bulletinFictionDocuments.updatedAt
        }).from(bulletinFictionDocuments)
          .where(eq(bulletinFictionDocuments.ownerId, ownerId))
          .orderBy(desc(bulletinFictionDocuments.updatedAt))
          .limit(100);
        return response.status(200).json({ documents });
      }

      if (request.method === 'POST') {
        const validated = validateDocument(request.body);
        if (validated.error) return response.status(400).json({ error: validated.error });
        const [document] = await activeDatabase.insert(bulletinFictionDocuments)
          .values({ ownerId, ...validated.value })
          .returning({
            id: bulletinFictionDocuments.id,
            title: bulletinFictionDocuments.title,
            sourceText: bulletinFictionDocuments.sourceText,
            outlineText: bulletinFictionDocuments.outlineText,
            draftText: bulletinFictionDocuments.draftText,
            createdAt: bulletinFictionDocuments.createdAt,
            updatedAt: bulletinFictionDocuments.updatedAt
          });
        return response.status(201).json({ document });
      }

      const id = request.method === 'DELETE' ? request.query?.id : request.body?.id;
      if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
        return response.status(400).json({ error: 'Taslak kimliği geçersiz.' });
      }

      if (request.method === 'DELETE') {
        const [deleted] = await activeDatabase.delete(bulletinFictionDocuments)
          .where(and(eq(bulletinFictionDocuments.id, id), eq(bulletinFictionDocuments.ownerId, ownerId)))
          .returning({ id: bulletinFictionDocuments.id });
        if (!deleted) return response.status(404).json({ error: 'Taslak bulunamadı.' });
        return response.status(200).json({ deleted: true });
      }

      const validated = validateDocument(request.body);
      if (validated.error) return response.status(400).json({ error: validated.error });
      const [document] = await activeDatabase.update(bulletinFictionDocuments)
        .set({ ...validated.value, updatedAt: new Date() })
        .where(and(eq(bulletinFictionDocuments.id, id), eq(bulletinFictionDocuments.ownerId, ownerId)))
        .returning({
          id: bulletinFictionDocuments.id,
          title: bulletinFictionDocuments.title,
          sourceText: bulletinFictionDocuments.sourceText,
          outlineText: bulletinFictionDocuments.outlineText,
          draftText: bulletinFictionDocuments.draftText,
          createdAt: bulletinFictionDocuments.createdAt,
          updatedAt: bulletinFictionDocuments.updatedAt
        });
      if (!document) return response.status(404).json({ error: 'Taslak bulunamadı.' });
      return response.status(200).json({ document });
    } catch (error) {
      console.error('[fiction-documents] Request failed:', error?.code || 'FICTION_DOCUMENTS_ERROR');
      return response.status(503).json({ error: 'Taslak servisi şu anda kullanılamıyor.' });
    }
  };
}

module.exports = createFictionDocumentsHandler();
module.exports.createFictionDocumentsHandler = createFictionDocumentsHandler;
module.exports.validateDocument = validateDocument;
