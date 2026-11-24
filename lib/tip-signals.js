(function (root, factory) {
  const parser = factory();
  if (typeof module === 'object' && module.exports) module.exports = parser;
  else root.TipSignals = parser;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const labels = [
    ['banko', /\bbanko\b/i],
    ['favorite', /\bfavori(?:m)?\b/i],
    ['place', /\bplase(?:\s+plase)?\b/i],
    ['rival', /\brakip\b/i],
    ['surprise', /\bsurpriz\b/i]
  ];

  function parseAnalystSignals(text) {
    const signalsByRace = {};
    for (const sourceLine of String(text || '').split(/\r?\n/)) {
      const line = sourceLine.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[ıİ]/g, 'i');
      const heading = /^\s*(\d{1,2})\s*(?:\.\s*)?(?:kosu|ayak)\s*[:\-]\s*(.+)$/i.exec(line);
      if (!heading) continue;
      const raceNo = Number(heading[1]);
      if (raceNo < 1 || raceNo > 30) continue;
      const details = heading[2];
      const signals = {};
      for (let index = 0; index < labels.length; index += 1) {
        const [key, pattern] = labels[index];
        const match = pattern.exec(details);
        if (!match) continue;
        const remainder = details.slice(match.index + match[0].length);
        const nextLabel = labels
          .map(([, nextPattern]) => nextPattern.exec(remainder)?.index)
          .filter((position) => position !== undefined);
        const segment = remainder.slice(0, nextLabel.length ? Math.min(...nextLabel) : remainder.length);
        const numbers = [...segment.matchAll(/#?\b(\d{1,2})\b/g)]
          .map((item) => Number(item[1]))
          .filter((number, numberIndex, all) => number > 0 && all.indexOf(number) === numberIndex);
        if (numbers.length) signals[key] = numbers;
      }
      if (Object.keys(signals).length) signalsByRace[raceNo] = signals;
    }
    return signalsByRace;
  }

  function scoreAnalystSignal(number, signals) {
    const runnerNumber = Number(number);
    if (!Number.isSafeInteger(runnerNumber) || runnerNumber < 1 || !signals || typeof signals !== 'object') return null;
    const categoryScores = [
      ['banko', 100],
      ['favorite', 92],
      ['place', 76],
      ['rival', 68],
      ['surprise', 52]
    ];
    const hasSignal = categoryScores.some(([category]) => Array.isArray(signals[category]) && signals[category].length > 0);
    if (!hasSignal) return null;
    const scores = categoryScores.flatMap(([category, base]) => {
      const picks = Array.isArray(signals[category]) ? signals[category] : [];
      const index = picks.indexOf(runnerNumber);
      return index < 0 ? [] : [Math.max(35, base - index * 8)];
    });
    return scores.length ? Math.max(...scores) : 50;
  }

  return { parseAnalystSignals, scoreAnalystSignal };
});
