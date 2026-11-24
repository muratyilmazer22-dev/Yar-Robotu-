(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RaceContextPerformance = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  function normalize(value) {
    return String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function parseRaceTime(value) {
    const parts = String(value || '').trim().replace(/,/g, '.').split(/[.:]/);
    if (parts.length === 3 && parts.every((part) => /^\d{1,2}$/.test(part))) {
      const [minutes, seconds, hundredths] = parts.map(Number);
      if (seconds >= 60 || hundredths >= 100) return null;
      return minutes * 60 + seconds + hundredths / 100;
    }
    if (parts.length === 2 && parts.every((part) => /^\d{1,2}$/.test(part))) {
      const [first, second] = parts.map(Number);
      if (first <= 5 && second < 60) return first * 60 + second;
      return first + second / (parts[1].length === 1 ? 10 : 100);
    }
    return null;
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function createIndex(archive) {
    const index = new Map();
    const jockeyIndex = new Map();
    for (const row of Array.isArray(archive) ? archive : []) {
      const date = String(row?.race_date || row?.raceDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const results = new Map((Array.isArray(row.results?.runners) ? row.results.runners : []).map((runner) => [Number(runner.horseNumber ?? runner.no), runner]));
      const program = row.program || {};
      const distance = Number(program.distance) || null;
      for (const runner of Array.isArray(program.runners) ? program.runners : []) {
        const number = Number(runner?.horseNumber ?? runner?.no);
        const result = results.get(number);
        const place = Number(result?.finishPosition);
        if (!runner?.name || runner.scratched || !Number.isFinite(place) || place < 1 || place > 20) continue;
        const name = normalize(runner.name);
        if (!name) continue;
        const timeSeconds = parseRaceTime(result.time);
        const starts = index.get(name) || [];
        const start = {
          date,
          place,
          city: normalize(row.city),
          weather: normalize(program.weather),
          surface: normalize(program.surface),
          trackCondition: normalize(program.trackCondition),
          surfaceChange: normalize(program.surfaceChange),
          distance,
          timePace: timeSeconds && distance ? timeSeconds * 1000 / distance : null,
          jockey: normalize(runner.jockey),
          weight: Number(runner.weight) || null
        };
        starts.push(start);
        index.set(name, starts);
        if (start.jockey) {
          const jockeyStarts = jockeyIndex.get(start.jockey) || [];
          jockeyStarts.push(start);
          jockeyIndex.set(start.jockey, jockeyStarts);
        }
      }
    }
    index.jockeyIndex = jockeyIndex;
    return index;
  }

  function contextualScore(starts) {
    if (!starts.length) return null;
    const average = starts.reduce((sum, start) => sum + Math.max(0, 100 - (start.place - 1) * 12), 0) / starts.length;
    const confidence = starts.length / (starts.length + 4);
    return Math.round((50 + (average - 50) * confidence) * 10) / 10;
  }

  function scoreForHorse(index, horseName, context = {}, beforeDate = '') {
    const name = normalize(horseName);
    const cutoff = String(beforeDate || context.date || '').slice(0, 10);
    const prior = (index instanceof Map ? index.get(name) || [] : []).filter((start) => !cutoff || start.date < cutoff);
    const matching = (predicate) => prior.filter(predicate);
    const city = normalize(context.city);
    const weather = normalize(context.weather);
    const surface = normalize(context.surface);
    const trackCondition = normalize(context.trackCondition);
    const surfaceChange = normalize(context.surfaceChange);
    const venue = city ? contextualScore(matching((start) => start.city === city)) : null;
    const weatherFit = weather ? contextualScore(matching((start) => start.weather === weather)) : null;
    const trackFit = surface || trackCondition || surfaceChange
      ? contextualScore(matching((start) => (!surface || start.surface === surface)
        && (!trackCondition || start.trackCondition === trackCondition)
        && (!surfaceChange || start.surfaceChange === surfaceChange)))
      : null;
    const requestedJockey = normalize(context.jockey);
    const distance = Number(context.distance);
    const comparableStart = (start) => (!surface || start.surface === surface)
      && (!Number.isFinite(distance) || distance <= 0 || (Number.isFinite(start.distance) && Math.abs(start.distance - distance) <= 200));
    const sameHorseJockeyStarts = requestedJockey
      ? matching((start) => start.jockey === requestedJockey && comparableStart(start))
      : [];
    const allJockeyStarts = requestedJockey && index.jockeyIndex instanceof Map
      ? (index.jockeyIndex.get(requestedJockey) || []).filter((start) => (!cutoff || start.date < cutoff) && comparableStart(start))
      : [];
    const venueJockeyStarts = city ? allJockeyStarts.filter((start) => start.city === city) : [];
    const jockeyStarts = venueJockeyStarts.length >= 3 ? venueJockeyStarts : allJockeyStarts;
    const riderFit = contextualScore(jockeyStarts);
    const samePairFit = contextualScore(sameHorseJockeyStarts);
    const pairConfidence = sameHorseJockeyStarts.length / (sameHorseJockeyStarts.length + 4);
    const jockeyFit = riderFit === null
      ? samePairFit
      : samePairFit === null
        ? riderFit
        : Math.round((riderFit * (1 - pairConfidence * 0.5) + samePairFit * pairConfidence * 0.5) * 10) / 10;
    const distanceFit = Number.isFinite(distance) && distance > 0
      ? contextualScore(matching((start) => Number.isFinite(start.distance) && Math.abs(start.distance - distance) <= 200 && (!surface || start.surface === surface)))
      : null;
    const lastStart = prior.at(-1);
    const restDays = lastStart && cutoff ? Math.round((Date.parse(`${cutoff}T12:00:00Z`) - Date.parse(`${lastStart.date}T12:00:00Z`)) / 86400000) : null;
    const restFit = restDays !== null && restDays > 0 ? Math.max(20, Math.min(100, 100 - Math.abs(restDays - 28) * 1.4)) : null;
    const weights = prior.filter((start) => start.weight && context.weight && Math.abs(start.weight - Number(context.weight)) <= 5 && comparableStart(start));
    const weightFit = weights.length ? contextualScore(weights) : null;
    const timedStarts = Number.isFinite(distance) && distance > 0
      ? prior.filter((start) => Number.isFinite(start.timePace)
        && Number.isFinite(start.distance)
        && Math.abs(start.distance - distance) <= 200
        && (!surface || start.surface === surface))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3)
      : [];
    const timePace = median(timedStarts.map((start) => start.timePace));
    return {
      venueFit: venue,
      weatherFit,
      trackFit,
      jockeyFit,
      jockeyStarts: jockeyStarts.length,
      jockeyWins: jockeyStarts.filter((start) => start.place === 1).length,
      jockeyTopThree: jockeyStarts.filter((start) => start.place <= 3).length,
      jockeyHorsePairStarts: sameHorseJockeyStarts.length,
      distanceFit,
      distanceStarts: matching((start) => Number.isFinite(distance) && distance > 0 && Number.isFinite(start.distance) && Math.abs(start.distance - distance) <= 200 && (!surface || start.surface === surface)).length,
      restFit,
      weightFit,
      weightStarts: weights.length,
      restDays,
      timePace,
      timedStarts: timedStarts.length
    };
  }

  return { normalize, parseRaceTime, createIndex, scoreForHorse };
});
