const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const requestsByIp = new Map();

function hasValidImageSignature(buffer, mimeType) {
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function isRateLimited(ip, now = Date.now()) {
  for (const [key, entry] of requestsByIp) {
    if (entry.resetAt <= now) requestsByIp.delete(key);
  }
  const current = requestsByIp.get(ip);
  if (!current || current.resetAt <= now) {
    requestsByIp.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (current.count >= RATE_LIMIT_MAX) return true;
  current.count += 1;
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Yalnızca POST isteği kabul edilir." });
  }
  if (!req.headers?.["content-type"]?.toLowerCase().includes("application/json")) {
    return res.status(415).json({ error: "İstek JSON biçiminde olmalıdır." });
  }
  const mode = req.body?.mode || "result";
  if (mode !== "result" && mode !== "notes") {
    return res.status(400).json({ error: "Görsel okuma türü geçersiz." });
  }

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(req.body?.image || "");
  if (!match || match[2].length % 4 !== 0 || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    return res.status(400).json({ error: "Yalnızca 3 MB’a kadar JPG, PNG veya WebP görsel gönderilebilir." });
  }

  const imageBuffer = Buffer.from(match[2], "base64");
  if (imageBuffer.length > MAX_IMAGE_BYTES || !hasValidImageSignature(imageBuffer, match[1])) {
    return res.status(400).json({ error: "Görsel biçimi doğrulanamadı veya dosya sınırı aşıldı." });
  }

  const forwardedIp = String(req.headers["x-real-ip"] || "").split(",")[0].trim();
  const ip = forwardedIp || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Görsel okuma sınırına ulaşıldı. Birkaç dakika sonra tekrar deneyin." });
  }

  try {
    const { generateText } = await import("ai");
    const { text } = await generateText({
      model: "google/gemini-3-flash",
      maxOutputTokens: 2500,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: mode === "notes"
              ? "Bu görsel bir at yarışı gazetesi veya uzman tahmin notu olabilir. Yalnızca görüntüde açıkça basılı olan tahmin/not metnini aynen aktar; koşu numarası, at numarası/adı ve Banko, Favori, Plase, Rakip, Sürpriz gibi etiketleri koru. Sıra, derece veya resmi yarış sonucu bilgilerini tahmin diye yorumlama; tahmin veya eksik bilgi üretme. Okunamayan bölümü 'OKUNAMADI' yaz. Görselde uzman tahmini/notu yoksa tek başına [NO_EXPERT_NOTES] döndür. Markdown, tablo kod çiti veya açıklama ekleme."
              : "Bu görsel bir at yarışı sonuç tablosu olabilir. Yalnızca görüntüde açıkça yazan sonuç verilerini metne aktar; tahmin veya eksik bilgi üretme. TJK satırlarında her koşuyu '1. Koşu' gibi başlıkla, ardından sekmeyle ayrılmış 'At No\tAt Adı\tSıra' sütunlarıyla yaz. Görüntüde birden çok koşu varsa hepsini sırayla aktar. At numarası, at adı ve Sıra/Rank/Position değerlerini olduğu gibi koru; okunamayan hücreyi 'OKUNAMADI' yaz. Sonuç tablosu değilse kısa bir uyarı ver. Markdown tablo çiti veya açıklama ekleme."
          },
          { type: "file", mediaType: match[1], data: new Uint8Array(imageBuffer) }
        ]
      }]
    });
    const recognizedText = String(text || "").trim();
    if (!recognizedText) return res.status(422).json({ error: "Görselden metin okunamadı. Daha net bir görüntü seçin." });
    return res.status(200).json({ text: recognizedText.slice(0, 50000) });
  } catch {
    return res.status(502).json({ error: "Görsel şu an okunamadı. Biraz sonra yeniden deneyin." });
  }
};
