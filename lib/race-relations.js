(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RaceRelations = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  function normalizeName(value) {
    return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function createIndex(archive) {
    const index = new Map();
    for (const row of Array.isArray(archive) ? archive : []) {
      const date = String(row?.race_date || "").slice(0, 10);
      const raceType = String(row?.program?.raceType || row?.program?.raceCategory || row?.program?.title || "");
      const runners = Array.isArray(row?.program?.runners) ? row.program.runners : [];
      const places = new Map((Array.isArray(row?.results?.runners) ? row.results.runners : []).map((runner) => [Number(runner.horseNumber ?? runner.no), Number(runner.finishPosition)]));
      const raceRunners = runners.map((runner) => ({
        name: String(runner?.name || ""),
        key: normalizeName(runner?.name),
        place: places.get(Number(runner?.horseNumber ?? runner?.no))
      })).filter((runner) => runner.key && Number.isInteger(runner.place) && runner.place > 0 && runner.place <= 20);
      for (const runner of raceRunners) {
        const starts = index.get(runner.key) || [];
        starts.push({ date, position: runner.place, jockey: String(runners.find((item) => normalizeName(item?.name) === runner.key)?.jockey || ""), fieldSize: raceRunners.length, raceType, field: raceRunners });
        index.set(runner.key, starts);
      }
    }
    return index;
  }

  function canonicalRaceClass(value) {
    const text = normalizeName(value);
    const number = (text.match(/(?:handikap|handicap|kv|kisa vade|sartli|acik|open|grup|g)\s*[- ]?(\d{1,2})/) || [])[1];
    const level = Number(number);
    if (text.includes("maiden")) return "maiden";
    if (text.includes("satis") || text.includes("selling")) return "satis";
    if (text.includes("handikap") || text.includes("handicap")) return level >= 21 ? "handikap-21-24" : level >= 16 ? "handikap-16-17" : level >= 13 ? "handikap-13-15" : `handikap-${level || ""}`;
    if (text.includes("sartli") || text.includes("conditions")) return level >= 4 ? "sartli-4-5" : level >= 2 ? "sartli-2-3" : "sartli-1";
    if (text.includes("kv") || text.includes("kisa vade") || text.includes("short term")) return `kv-${level || ""}`;
    if (text.includes("acik") || text.includes("open") || /\bg\s*\d/.test(text)) return `acik-${level || ""}`;
    return text;
  }

  function scoreHorseJockeyPair(archive, horse, raceType, beforeDate) {
    const horseKey = normalizeName(horse?.name);
    const jockeyKey = normalizeName(horse?.jockey);
    const targetClass = canonicalRaceClass(raceType);
    const cutoff = String(beforeDate || "").slice(0, 10);
    if (!horseKey || !jockeyKey || !targetClass) return null;
    const index = archive instanceof Map ? archive : createIndex(archive);
    const starts = (index.get(horseKey) || []).filter((start) =>
      start.date < cutoff && normalizeName(start.jockey) === jockeyKey && canonicalRaceClass(start.raceType) === targetClass
    );
    if (!starts.length) return null;
    const places = starts.map((start) => start.fieldSize > 1
      ? Math.max(0, Math.min(100, (start.fieldSize - start.position) / (start.fieldSize - 1) * 100))
      : start.position === 1 ? 100 : 0);
    const average = places.reduce((sum, place) => sum + place, 0) / places.length;
    const confidence = starts.length / (starts.length + 3);
    return {
      score: Math.round((50 + (average - 50) * confidence) * 10) / 10,
      starts: starts.length,
      wins: starts.filter((start) => start.position === 1).length,
      topThree: starts.filter((start) => start.position <= 3).length
    };
  }

  function horseInsights(race, horse, archive, beforeDate) {
    const horseKey = normalizeName(horse?.name);
    const jockeyKey = normalizeName(horse?.jockey);
    const cutoff = String(beforeDate || race?.date || "").slice(0, 10);
    const index = archive instanceof Map ? archive : createIndex(archive);
    const opponents = new Set((Array.isArray(race?.horses) ? race.horses : []).map((item) => normalizeName(item?.name)).filter((key) => key && key !== horseKey));
    const jockeyPlaces = [];
    const meetings = new Map();

    for (const start of index.get(horseKey) || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start.date) || (cutoff && start.date >= cutoff)) continue;
      if (jockeyKey && normalizeName(start.jockey) === jockeyKey) jockeyPlaces.push(start.position);
      for (const rival of start.field) {
        if (!opponents.has(rival.key)) continue;
        const stats = meetings.get(rival.key) || { name: rival.name, meetings: 0, ahead: 0 };
        stats.meetings += 1;
        if (start.position < rival.place) stats.ahead += 1;
        meetings.set(rival.key, stats);
      }
    }

    return {
      jockey: { available: Boolean(jockeyKey), starts: jockeyPlaces.length, wins: jockeyPlaces.filter((place) => place === 1).length, topThree: jockeyPlaces.filter((place) => place <= 3).length },
      headToHead: [...meetings.values()].sort((a, b) => b.meetings - a.meetings || b.ahead - a.ahead)[0] || null
    };
  }

  function scoreAgainstField(race, horse, archive, beforeDate) {
    const horseKey = normalizeName(horse?.name);
    if (!horseKey) return null;
    const cutoff = String(beforeDate || race?.date || '').slice(0, 10);
    const index = archive instanceof Map ? archive : createIndex(archive);
    const opponents = new Set((Array.isArray(race?.horses) ? race.horses : [])
      .map((item) => normalizeName(item?.name))
      .filter((key) => key && key !== horseKey));
    if (!opponents.size) return null;

    let ahead = 0;
    let tied = 0;
    let meetings = 0;
    for (const start of index.get(horseKey) || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start.date) || (cutoff && start.date >= cutoff)) continue;
      for (const rival of start.field) {
        if (!opponents.has(rival.key) || !Number.isInteger(rival.place) || rival.place < 1) continue;
        meetings += 1;
        if (start.position < rival.place) ahead += 1;
        else if (start.position === rival.place) tied += 1;
      }
    }
    if (!meetings) return null;
    const observed = (ahead + tied * 0.5) / meetings * 100;
    const confidence = meetings / (meetings + 4);
    return Math.round((50 + (observed - 50) * confidence) * 10) / 10;
  }

  function repeatedJockeysAcrossLegs(races) {
    const legsByJockey = new Map();
    for (const race of Array.isArray(races) ? races : []) {
      for (const horse of Array.isArray(race?.horses) ? race.horses : []) {
        const key = normalizeName(horse?.jockey);
        if (!key) continue;
        const legs = legsByJockey.get(key) || new Set();
        legs.add(String(race.no ?? ""));
        legsByJockey.set(key, legs);
      }
    }
    return [...legsByJockey.values()].filter((legs) => legs.size > 1).length;
  }

  return { normalizeName, canonicalRaceClass, createIndex, horseInsights, scoreHorseJockeyPair, scoreAgainstField, repeatedJockeysAcrossLegs };
});
