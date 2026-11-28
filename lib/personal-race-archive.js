(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PersonalRaceArchive = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  function normalize(value) {
    return String(value || "").toLocaleUpperCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "I").replace(/[^A-Z0-9]/g, "");
  }

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function raceNumber(race) {
    const value = Number(race?.no ?? race?.raceNo);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function horseNumber(horse) {
    const value = Number(horse?.horseNumber ?? horse?.number ?? horse?.no);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function parseBulletin(text, parseRaces) {
    if (typeof parseRaces !== "function" || !String(text || "").trim()) return [];
    try {
      const parsed = parseRaces(text);
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.races) ? parsed.races : [];
    } catch {
      return [];
    }
  }

  function isSavedBulletin(item, kind) {
    return item?.kind === kind && item.status === "saved" && typeof item.text === "string" && item.text.trim();
  }

  function isBeforeResult(programBulletin, resultBulletin) {
    const programTime = Date.parse(programBulletin.savedAt || programBulletin.updatedAt || "") || 0;
    const resultTime = Date.parse(resultBulletin.savedAt || resultBulletin.reviewedAt || resultBulletin.updatedAt || "") || 0;
    return !programTime || !resultTime || programTime <= resultTime;
  }

  function matchRace(resultRace, programRace, resultBulletin, programBulletin) {
    const no = raceNumber(resultRace);
    if (!no || no !== raceNumber(programRace)) return null;

    const listedRunners = (Array.isArray(programRace.horses) ? programRace.horses : [])
      .filter((horse) => !horse.scratched && horseNumber(horse) && normalize(horse.name));
    const resultRunners = (Array.isArray(resultRace.horses) ? resultRace.horses : [])
      .map((horse) => ({ horse, number: horseNumber(horse), place: Number(horse.rank ?? horse.place) }))
      .filter(({ horse, number, place }) => number && normalize(horse.name) && Number.isSafeInteger(place) && place > 0);
    const winners = resultRunners.filter(({ place }) => place === 1);
    if (listedRunners.length < 2 || resultRunners.length !== listedRunners.length || winners.length !== 1) return null;

    const programByNumber = new Map();
    for (const horse of listedRunners) {
      const number = horseNumber(horse);
      if (programByNumber.has(number)) return null;
      programByNumber.set(number, horse);
    }
    const resultNumbers = new Set();
    const matchedResults = [];
    for (const { horse, number, place } of resultRunners) {
      if (resultNumbers.has(number)) return null;
      resultNumbers.add(number);
      const runner = programByNumber.get(number);
      if (!runner || normalize(runner.name) !== normalize(horse.name)) return null;
      matchedResults.push({ horse, number, place });
    }
    if (resultNumbers.size !== programByNumber.size) return null;

    const runners = listedRunners.map((runner) => ({
      horseNumber: horseNumber(runner),
      no: horseNumber(runner),
      name: String(runner.name || "").trim(),
      jockey: String(runner.jockey || "").trim(),
      weight: Number(runner.weight) || null,
      handicapPoints: Number(runner.handicapPoints ?? runner.hp) || null,
      agf: Number(runner.agf) || null,
      form: String(runner.form || runner.last6 || ""),
      sire: String(runner.sire || ""),
      dam: String(runner.dam || ""),
      damSire: String(runner.damSire || ""),
      origin: String(runner.origin || ""),
      scratched: false
    }));
    const resultRows = matchedResults.map(({ horse, number, place }) => ({
      horseNumber: number,
      no: number,
      name: String(horse.name || "").trim(),
      finishPosition: place,
      odds: Number(horse.odds) || null,
      time: String(horse.time || "")
    }));

    return {
      city: String(programBulletin.city || resultBulletin.city || "").trim(),
      race_date: String(programBulletin.date || resultBulletin.date || "").slice(0, 10),
      race_no: no,
      program: {
        distance: Number(programRace.distance) > 0 ? Number(programRace.distance) : null,
        surface: String(programRace.surface || ""),
        weather: String(programRace.weather || ""),
        trackCondition: String(programRace.trackCondition || ""),
        surfaceChange: String(programRace.surfaceChange || ""),
        raceType: String(programRace.raceType || programRace.type || programRace.title || ""),
        title: String(programRace.title || ""),
        runners
      },
      results: { runners: resultRows },
      personalArchive: true,
      resultBulletinId: resultBulletin.id || "",
      programBulletinId: programBulletin.id || ""
    };
  }

  function bulletinPrograms(bulletins, parseRaces) {
    return (Array.isArray(bulletins) ? bulletins : [])
      .filter((item) => isSavedBulletin(item, "program") && item.analysisStatus === "complete" && validDate(item.date) && normalize(item.city))
      .map((bulletin) => ({ bulletin, races: parseBulletin(bulletin.text, parseRaces) }))
      .filter((entry) => entry.races.length)
      .sort((a, b) => String(b.bulletin.savedAt || b.bulletin.updatedAt || "").localeCompare(String(a.bulletin.savedAt || a.bulletin.updatedAt || "")));
  }

  function findProgramContextInArchive(resultRaces, programs, filters = {}) {
    const wantedDate = String(filters.date || "").slice(0, 10);
    const wantedCity = normalize(filters.city || "");
    const candidates = [];
    for (const { bulletin, races } of programs) {
      if (wantedDate && bulletin.date !== wantedDate) continue;
      if (wantedCity && normalize(bulletin.city) !== wantedCity) continue;
      if (filters.resultBulletin && !isBeforeResult(bulletin, filters.resultBulletin)) continue;
      const rows = [];
      for (const resultRace of Array.isArray(resultRaces) ? resultRaces : []) {
        const raceMatches = races.filter((race) => raceNumber(race) === raceNumber(resultRace));
        if (raceMatches.length !== 1) continue;
        const row = matchRace(resultRace, raceMatches[0], filters.resultBulletin || {}, bulletin);
        if (row) rows.push(row);
      }
      if (rows.length) candidates.push({ bulletin, rows, horseCount: rows.reduce((sum, row) => sum + row.results.runners.length, 0) });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.rows.length - a.rows.length || b.horseCount - a.horseCount || String(b.bulletin.savedAt || "").localeCompare(String(a.bulletin.savedAt || "")));
    const best = candidates[0];
    const tiedContexts = candidates.filter((candidate) => candidate.rows.length === best.rows.length && candidate.horseCount === best.horseCount);
    const contextKeys = new Set(tiedContexts.map(({ bulletin }) => `${bulletin.date}|${normalize(bulletin.city)}`));
    if (contextKeys.size > 1) return null;
    return {
      date: best.bulletin.date,
      city: best.bulletin.city,
      bulletinId: best.bulletin.id || "",
      matchedRaceCount: best.rows.length,
      matchedHorseCount: best.horseCount,
      rows: best.rows
    };
  }

  function findProgramContext(resultRaces, bulletins, parseRaces, filters = {}) {
    return findProgramContextInArchive(resultRaces, bulletinPrograms(bulletins, parseRaces), filters);
  }

  function buildArchive(bulletins, parseRaces) {
    const records = new Map();
    const programs = bulletinPrograms(bulletins, parseRaces);
    const savedResults = (Array.isArray(bulletins) ? bulletins : [])
      .filter((item) => isSavedBulletin(item, "result") && validDate(item.date) && normalize(item.city))
      .sort((a, b) => String(a.savedAt || "").localeCompare(String(b.savedAt || "")));
    for (const resultBulletin of savedResults) {
      const resultRaces = parseBulletin(resultBulletin.text, parseRaces);
      const raceNumbers = resultRaces.map(raceNumber);
      if (!resultRaces.length || raceNumbers.some((number) => !number) || new Set(raceNumbers).size !== raceNumbers.length) continue;
      const match = findProgramContextInArchive(resultRaces, programs, {
        date: resultBulletin.date,
        city: resultBulletin.city,
        resultBulletin
      });
      if (!match) continue;
      for (const row of match.rows) {
        const key = `${row.race_date}|${normalize(row.city)}|${row.race_no}`;
        records.set(key, row);
      }
    }
    return [...records.values()];
  }

  return { normalize, matchRace, findProgramContext, buildArchive };
});
