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
      const date = String(row?.race_date || row?.raceDate || "").slice(0, 10);
      const rank = classRank(row);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const runners = Array.isArray(row.program?.runners) ? row.program.runners : [];
      const results = new Map((Array.isArray(row.results?.runners) ? row.results.runners : []).map((item) => [Number(item.horseNumber ?? item.no), Number(item.finishPosition)]));
      const placedRunners = runners.filter((runner) => runner && !runner.scratched && Number.isInteger(results.get(Number(runner.horseNumber ?? runner.no))) && results.get(Number(runner.horseNumber ?? runner.no)) > 0);
      const fieldSize = placedRunners.length;
      const hpValues = runners.filter((runner) => runner && !runner.scratched).map((runner) => Number(runner.handicapPoints)).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
      const middle = Math.floor(hpValues.length / 2);
      const medianHp = hpValues.length ? hpValues.length % 2 ? hpValues[middle] : (hpValues[middle - 1] + hpValues[middle]) / 2 : null;
      const classSignal = rank === null ? null : Math.max(0, Math.min(100, (rank - 5) / 30 * 100));
      const fieldSignal = medianHp === null ? null : Math.max(0, Math.min(100, medianHp));
      const groupStrength = classSignal !== null && fieldSignal !== null ? classSignal * 0.55 + fieldSignal * 0.45 : classSignal ?? fieldSignal;
      for (const runner of runners) {
        if (!runner?.name || runner.scratched) continue;
        const place = results.get(Number(runner.horseNumber ?? runner.no));
        if (!Number.isInteger(place) || place < 1 || place > 20) continue;
        const name = normalizeName(runner.name);
        if (!name) continue;
        const finishScore = fieldSize > 1 ? Math.max(0, Math.min(100, (fieldSize - place) / (fieldSize - 1) * 100)) : 50;
        const groupFit = groupStrength === null ? null : groupStrength * 0.55 + finishScore * 0.45;
        const starts = index.get(name) || [];
        starts.push({ date, rank, place, groupStrength, groupFit });
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

  function groupFitForHorse(archive, horseName, beforeDate) {
    const name = normalizeName(horseName);
    if (!name) return null;
    const cutoff = String(beforeDate || "").slice(0, 10);
    const index = archive instanceof Map ? archive : createIndex(archive);
    const recent = (index.get(name) || []).filter((start) => (!cutoff || start.date < cutoff) && Number.isFinite(start.groupFit)).slice(0, 6);
    if (!recent.length) return null;
    const weighted = recent.map((start, position) => ({ score: start.groupFit, weight: 1 / (position + 1) }));
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    const average = weighted.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
    const confidence = recent.length / (recent.length + 3);
    return Math.round((50 + (average - 50) * confidence) * 10) / 10;
  }

  return { normalizeName, classRank, createIndex, scoreForHorse, groupFitForHorse };
});
