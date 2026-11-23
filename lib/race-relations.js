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
      const runners = Array.isArray(row?.program?.runners) ? row.program.runners : [];
      const places = new Map((Array.isArray(row?.results?.runners) ? row.results.runners : []).map((runner) => [Number(runner.horseNumber ?? runner.no), Number(runner.finishPosition)]));
      const raceRunners = runners.map((runner) => ({
        name: String(runner?.name || ""),
        key: normalizeName(runner?.name),
        place: places.get(Number(runner?.horseNumber ?? runner?.no))
      })).filter((runner) => runner.key && Number.isInteger(runner.place) && runner.place > 0 && runner.place <= 20);
      for (const runner of raceRunners) {
        const starts = index.get(runner.key) || [];
        starts.push({ date, position: runner.place, jockey: String(runners.find((item) => normalizeName(item?.name) === runner.key)?.jockey || ""), field: raceRunners });
        index.set(runner.key, starts);
      }
    }
    return index;
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

  return { normalizeName, createIndex, horseInsights, repeatedJockeysAcrossLegs };
});
