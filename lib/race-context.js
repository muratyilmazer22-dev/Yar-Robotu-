(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RaceContextPerformance = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  function normalize(value) {
    return String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function createIndex(archive) {
    const index = new Map();
    for (const row of Array.isArray(archive) ? archive : []) {
      const date = String(row?.race_date || row?.raceDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const results = new Map((Array.isArray(row.results?.runners) ? row.results.runners : []).map((runner) => [Number(runner.horseNumber ?? runner.no), Number(runner.finishPosition)]));
      const program = row.program || {};
      for (const runner of Array.isArray(program.runners) ? program.runners : []) {
        const number = Number(runner?.horseNumber ?? runner?.no);
        const place = results.get(number);
        if (!runner?.name || runner.scratched || !Number.isFinite(place) || place < 1 || place > 20) continue;
        const name = normalize(runner.name);
        if (!name) continue;
        const starts = index.get(name) || [];
        starts.push({
          date,
          place,
          city: normalize(row.city),
          weather: normalize(program.weather),
          surface: normalize(program.surface),
          trackCondition: normalize(program.trackCondition),
          surfaceChange: normalize(program.surfaceChange)
        });
        index.set(name, starts);
      }
    }
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
    return { venueFit: venue, weatherFit, trackFit };
  }

  return { normalize, createIndex, scoreForHorse };
});
