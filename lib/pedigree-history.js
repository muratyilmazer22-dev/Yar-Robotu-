(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RacePedigreeHistory = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  function normalize(value) {
    return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function normalizeSurface(value) {
    const surface = normalize(value);
    if (["cim", "turf", "grass"].includes(surface)) return "cim";
    if (["kum", "dirt", "sand"].includes(surface)) return "kum";
    if (["sentetik", "synthetic", "aw", "polytrack", "tapeta"].includes(surface)) return "sentetik";
    return surface;
  }

  function distanceBand(distance) {
    const value = Number(distance);
    if (!Number.isFinite(value) || value <= 0) return "belirsiz";
    if (value <= 1300) return "kisa";
    if (value < 1800) return "orta";
    return "uzun";
  }

  function raceResultScore(place, fieldSize) {
    if (!Number.isInteger(place) || place < 1) return null;
    if (fieldSize > 1) return Math.max(0, Math.min(100, (fieldSize - place) / (fieldSize - 1) * 100));
    return 50;
  }

  function createIndex(archive) {
    const index = new Map();
    for (const row of Array.isArray(archive) ? archive : []) {
      const date = String(row?.race_date || row?.raceDate || "").slice(0, 10);
      const surface = normalizeSurface(row?.program?.surface);
      const band = distanceBand(row?.program?.distance);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !surface || band === "belirsiz") continue;
      const programRunners = Array.isArray(row.program?.runners) ? row.program.runners : [];
      const results = new Map((Array.isArray(row.results?.runners) ? row.results.runners : []).map((result) => [Number(result.horseNumber ?? result.no), Number(result.finishPosition)]));
      const fieldSize = programRunners.filter((runner) => runner && !runner.scratched && Number.isFinite(results.get(Number(runner.horseNumber ?? runner.no))) && results.get(Number(runner.horseNumber ?? runner.no)) > 0).length;
      for (const runner of programRunners) {
        if (!runner?.name || runner.scratched) continue;
        const place = results.get(Number(runner.horseNumber ?? runner.no));
        const score = raceResultScore(place, fieldSize);
        if (score === null) continue;
        const name = normalize(runner.name);
        if (!name) continue;
        const originParts = String(runner.origin || "").split(/\s*[-–—]\s*/);
        const damParts = (originParts.slice(1).join(" - ").split(/\s*\/\s*/) || []);
        const dam = runner.dam || damParts[0] || "";
        const damSire = runner.damSire || damParts.slice(1).join(" / ") || "";
        for (const [role, ancestor] of [["sire", runner.sire || originParts[0]], ["dam", dam], ["damSire", damSire]]) {
          const ancestorName = normalize(ancestor);
          if (!ancestorName) continue;
          const key = `${role}|${ancestorName}|${surface}|${band}`;
          const starts = index.get(key) || [];
          starts.push({ date, horse: name, score });
          index.set(key, starts);
        }
      }
    }
    for (const starts of index.values()) starts.sort((a, b) => b.date.localeCompare(a.date));
    return index;
  }

  function scoreLine(index, role, ancestor, surface, band, cutoff) {
    const key = `${role}|${normalize(ancestor)}|${surface}|${band}`;
    const starts = (index.get(key) || []).filter((start) => !cutoff || start.date < cutoff);
    const distinctHorses = new Set(starts.map((start) => start.horse)).size;
    if (distinctHorses < 3) return null;
    const average = starts.reduce((sum, start) => sum + start.score, 0) / starts.length;
    const confidence = starts.length / (starts.length + 6);
    return Math.round((50 + (average - 50) * confidence) * 10) / 10;
  }

  function scoreForHorse(index, horse, context = {}, beforeDate = "") {
    if (!(index instanceof Map)) return null;
    const surface = normalizeSurface(context.surface);
    const band = distanceBand(context.distance);
    if (!surface || !band || band === "belirsiz") return null;
    const cutoff = String(beforeDate || context.date || "").slice(0, 10);
    const originParts = String(horse?.origin || "").split(/\s*[-–—]\s*/);
    const damParts = (originParts.slice(1).join(" - ").split(/\s*\/\s*/) || []);
    const lines = [
      ["sire", horse?.sire || originParts[0], 0.45],
      ["dam", horse?.dam || damParts[0], 0.3],
      ["damSire", horse?.damSire || damParts.slice(1).join(" / "), 0.25]
    ].map(([role, ancestor, weight]) => ({ score: scoreLine(index, role, ancestor, surface, band, cutoff), weight })).filter((line) => line.score !== null);
    if (!lines.length) return null;
    const totalWeight = lines.reduce((sum, line) => sum + line.weight, 0);
    return Math.round(lines.reduce((sum, line) => sum + line.score * line.weight, 0) / totalWeight * 10) / 10;
  }

  return { normalize, normalizeSurface, distanceBand, raceResultScore, createIndex, scoreForHorse };
});
