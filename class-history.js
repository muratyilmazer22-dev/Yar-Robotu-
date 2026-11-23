(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RaceClassHistory = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  function normalizeName(value) {
    return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function classRank(value) {
    const text = normalizeName(typeof value === "string" ? value : value?.program?.raceType || value?.program?.raceCategory || value?.program?.title || value?.raceType || value?.raceCategory || value?.title || "");
    const numbered = text.match(/(?:handikap|kv|sartli|grup)\s*[- ]?(\d{1,2})/);
    if (numbered) {
      const level = Number(numbered[1]);
      if (text.includes("kv")) return 25 + level;
      if (text.includes("grup")) return 35 - level;
      if (text.includes("sartli")) return 15 + level;
      return 5 + level;
    }
    if (text.includes("acik") || text.includes("grup")) return 30;
    if (text.includes("kv")) return 25;
    if (text.includes("handikap")) return 20;
    if (text.includes("sartli")) return 15;
    if (text.includes("satis")) return 10;
    if (text.includes("maiden")) return 5;
    return null;
  }

  function createIndex(archive) {
    const index = new Map();
    for (const row of Array.isArray(archive) ? archive : []) {
      const date = String(row?.race_date || "").slice(0, 10);
      const rank = classRank(row);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || rank === null) continue;
      const results = new Map((Array.isArray(row.results?.runners) ? row.results.runners : []).map((item) => [Number(item.horseNumber ?? item.no), Number(item.finishPosition)]));
      for (const runner of Array.isArray(row.program?.runners) ? row.program.runners : []) {
        if (!runner?.name || runner.scratched) continue;
        const place = results.get(Number(runner.horseNumber ?? runner.no));
        if (!Number.isInteger(place) || place < 1 || place > 20) continue;
        const name = normalizeName(runner.name);
        if (!name) continue;
        const starts = index.get(name) || [];
        starts.push({ date, rank, place });
        index.set(name, starts);
      }
    }
    for (const starts of index.values()) starts.sort((a, b) => b.date.localeCompare(a.date));
    return index;
  }

  function scoreForHorse(archive, horseName, targetClass, beforeDate) {
    const name = normalizeName(horseName);
    const targetRank = classRank(targetClass);
    if (!name || targetRank === null) return null;
    const cutoff = String(beforeDate || "").slice(0, 10);
    const index = archive instanceof Map ? archive : createIndex(archive);
    const recent = (index.get(name) || []).filter((start) => !cutoff || start.date < cutoff).slice(0, 6);
    if (!recent.length) return null;
    const performances = recent.map(({ rank, place }, index) => {
      const finishScore = Math.max(0, 100 - (place - 1) * 10);
      const classAdjustment = Math.max(-6, Math.min(6, (rank - targetRank) * 0.6));
      const recencyWeight = 1 / (index + 1);
      return { score: Math.max(0, Math.min(100, finishScore + classAdjustment)), weight: recencyWeight };
    });
    const totalWeight = performances.reduce((sum, item) => sum + item.weight, 0);
    const average = performances.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
    const confidence = Math.min(1, recent.length / 3);
    return Math.round((50 + (average - 50) * confidence) * 10) / 10;
  }

  return { normalizeName, classRank, createIndex, scoreForHorse };
});
