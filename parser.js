(function (root, factory) {
  const parser = factory();
  if (typeof module === 'object' && module.exports) module.exports = parser;
  else root.RaceParser = parser;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  function fold(value) {
    return String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/\s+/g, ' ').trim();
  }

  function parseNumber(value) {
    const match = String(value || '').replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function parseAgfValues(value) {
    const matches = [...String(value || '').matchAll(/%\s*(\d+(?:[.,]\d+)?)/g)]
      .map((match) => Number(match[1].replace(',', '.')))
      .filter((number) => Number.isFinite(number) && number >= 0 && number <= 100);
    if (matches.length) return matches;
    const fallback = parseNumber(value);
    return fallback !== null && fallback >= 0 && fallback <= 100 ? [fallback] : [];
  }

  function isUsableHorseName(value) {
    const name = String(value || '').trim();
    return Boolean(name) && !/^(?:%?\s*\d+(?:[.,]\d+)?\s*%?|[-–—]+)$/.test(name);
  }

  function splitCells(line) {
    if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
    if (line.includes('|')) return line.split('|').map((cell) => cell.trim());
    return null;
  }

  function normalizeHeader(value) {
    return fold(value).replace(/[.#°º]/g, '').replace(/\s+/g, ' ').trim();
  }

  function isHorseNameHeader(header) {
    return header.includes('at ismi') || header === 'at adi' || header === 'at' || header.includes('horse name') || header === 'horse' || header === 'runner';
  }

  function isHorseNumberHeader(header) {
    return header === 'n' || header === 'no' || header.includes('at no') || header.includes('at numarasi') || header === 'numara' || header.includes('horse no') || header.includes('horse number') || header.includes('runner no') || header.includes('program no') || header.includes('program numarasi');
  }

  function parseOrigin(origin) {
    const parts = String(origin || '').split(/\s*[-–—]\s*/);
    const sire = (parts[0] || '').trim();
    const damLine = parts.slice(1).join(' - ');
    const damParts = damLine.split(/\s*\/\s*/);
    const dam = (damParts[0] || '').trim();
    const damSire = (damParts.slice(1).join(' / ') || '').trim();
    return { sire, dam, damSire };
  }

  function parseRaceConditions(text) {
    const lines = String(text || '').split(/\r?\n/).map(fold);
    const weatherMatch = lines.map((line) => line.match(/(?:hava durumu|hava)\s*[:：-]\s*(parcali bulutlu|az bulutlu|gunesli|acik|bulutlu|kapali|yagmurlu|saganak|sisli|ruzgarli|karli|kar yagisli)/)).find(Boolean);
    const trackMatch = lines.map((line) => line.match(/(?:pist durumu|pist zemini|hava\s*[/]\s*pist)\s*[:：-]?\s*(normal|islak|sulu|nemli|agir|hizli|yavas|cok agir)/)).find(Boolean);
    const changeMatch = lines.map((line) => line.match(/(?:pist|zemin|yaris)\s+degisikligi\s*[:：-]\s*([^.!?]{2,120})/)).find(Boolean);
    return { weather: weatherMatch?.[1] || '', trackCondition: trackMatch?.[1] || '', surfaceChange: changeMatch?.[1]?.trim() || '' };
  }

  function parseRaces(text) {
    const races = [];
    const conditions = parseRaceConditions(text);
    let current = null;
    let headers = null;

    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const raceHeader = line.match(/^(\d+)\.\s*(?:Koşu|Race)\s+(?:(\d{1,2}[.:]\d{2})\s*)?(.*)$/i);
      if (raceHeader) {
        if (current) races.push(current);
        const detail = raceHeader[3] || '';
        const distanceMatch = detail.match(/(\d{3,4})\s*(Kum|Çim|Sentetik)?/i);
        current = {
          no: Number(raceHeader[1]),
          time: raceHeader[2] || '',
          title: detail.split(',')[0].trim() || 'Koşu',
          raceType: detail.split(',')[0].trim() || '',
          distance: distanceMatch ? Number(distanceMatch[1]) : null,
          surface: distanceMatch?.[2] || 'Belirtilmedi',
          weather: conditions.weather,
          trackCondition: conditions.trackCondition,
          surfaceChange: conditions.surfaceChange,
          horses: []
        };
        headers = null;
        continue;
      }
      if (!current) continue;

      const cells = splitCells(raw);
      if (!cells) {
        const plainHorseMatch = line.match(/^(\d{1,2})[.)]?\s+(.+?)\s+(\d{1,2}y\s+[a-z]\s+[a-z])(?:\s|$)/i);
        if (plainHorseMatch) {
          const horseNumber = Number(plainHorseMatch[1]);
          const name = plainHorseMatch[2].replace(/\s+(?:KG|K|DB|SKG|SK)\b.*$/i, '').trim();
          if (isUsableHorseName(name)) {
            current.horses.push({
              no: horseNumber,
              horseNumber,
              name,
              sire: '',
              dam: '',
              damSire: '',
              origin: '',
              age: plainHorseMatch[3],
              weight: null,
              handicapPoints: null,
              programStartNumber: null,
              daysSinceLastRace: null,
              jockey: '',
              form: '',
              agf: null,
              odds: null,
              couplingGroup: '',
              scratched: /koşmaz|scratched/i.test(name),
              rank: 0
            });
          }
        }
        continue;
      }
      const normalizedHeaders = cells.map(normalizeHeader);
      const nameIndex = normalizedHeaders.findIndex(isHorseNameHeader);
      if (nameIndex >= 0) {
        headers = normalizedHeaders;
        continue;
      }
      if (cells.every((cell) => /^[-\s:]+$/.test(cell))) continue;

      let rowName = '';
      let horseNumber = null;
      let assumedRank = null;
      let legacyNo = null;
      if (headers) {
        const indexOf = (fragment) => headers.findIndex((header) => header === fragment || header.includes(fragment));
        const horseCellIndex = headers.findIndex(isHorseNameHeader);
        rowName = cells[horseCellIndex] || '';
        const horseMatch = rowName.match(/\((\d{1,2})\)/) || rowName.match(/^\s*(\d{1,2})\s*[-–.)]\s*/);
        const hashNumberMatch = rowName.match(/^\s*#\s*(\d{1,2})\s+(.+)$/);
        const column = (fragment) => {
          const index = indexOf(fragment);
          return index >= 0 ? cells[index] || '' : '';
        };
        const numberIndex = headers.findIndex(isHorseNumberHeader);
        const combinedNumberMatch = horseCellIndex === 0 && /^(?:n|no|at no|at numarasi|horse no|horse number|runner no|program no|program numarasi)\s+at (?:ismi|adi|name)\b/.test(headers[0])
          ? rowName.match(/^\s*(\d{1,2})\s+(.+)$/)
          : null;
        horseNumber = (numberIndex >= 0 ? parseNumber(cells[numberIndex]) : null) ?? (horseMatch ? Number(horseMatch[1]) : null) ?? (combinedNumberMatch ? Number(combinedNumberMatch[1]) : null) ?? (hashNumberMatch ? Number(hashNumberMatch[1]) : null);
        if (numberIndex >= 0 && (!Number.isSafeInteger(horseNumber) || horseNumber < 1)) continue;
        const explicitRankIndex = headers.findIndex((header) => header.includes('sira') || header.includes('sonuc') || header.includes('result') || header.includes('rank') || header.includes('placing') || header.includes('position'));
        const shortRankIndex = headers.indexOf('s');
        const hasResultTimeColumn = headers.some((header) => ['derece', 'time', 'zaman', 'finish time'].includes(header));
        const rankIndex = explicitRankIndex >= 0 ? explicitRankIndex : hasResultTimeColumn ? shortRankIndex : -1;
        assumedRank = rankIndex >= 0 ? parseNumber(cells[rankIndex]) : null;
        const origin = column('orijin');
        const pedigree = parseOrigin(origin);
        const weightText = column('siklet');
        const agfText = column('agf');
        const agfValues = parseAgfValues(agfText);
        const agf = agfValues.at(-1) ?? null;
        const form = column('form');
        const age = column('yas');
        const jockey = column('jokey');
        const handicapPoints = parseNumber(column('hp'));
        const programStartNumber = parseNumber(column('st'));
        const daysSinceLastRace = parseNumber(column('kgs'));
        const odds = parseNumber(column('gny'));
        const couplingGroup = column('ekuri') || column('ekuri grubu') || column('ekuri no');
        const weight = parseNumber(weightText);
        const name = (combinedNumberMatch ? combinedNumberMatch[2] : hashNumberMatch ? hashNumberMatch[2] : rowName).replace(/\s*\(\d{1,2}\).*$/, '').replace(/^\s*\d{1,2}\s*[-–.)]\s*/, '').replace(/\s+(?:KG|K|DB|SKG|SK)\b.*$/i, '').trim();
        if (!isUsableHorseName(name)) continue;
        current.horses.push({
          no: horseNumber,
          horseNumber,
          bulletinRowNumber: numberIndex >= 0 ? parseNumber(cells[numberIndex]) : null,
          parentheticalHorseNumber: horseMatch ? Number(horseMatch[1]) : null,
          name,
          sire: pedigree.sire,
          dam: pedigree.dam,
          damSire: pedigree.damSire,
          origin,
          age,
          weight,
          handicapPoints,
          programStartNumber,
          daysSinceLastRace,
          jockey,
          form,
          agf,
          agfPrevious: agfValues.length > 1 ? agfValues[0] : null,
          agfValues,
          odds,
          couplingGroup: couplingGroup.trim(),
          scratched: /koşmaz|scratched/i.test(rowName),
rank: Number.isFinite(assumedRank) ? assumedRank : 0
        });
        continue;
      }

      if (cells.length >= 3 && !cells[0] && /^\d{1,2}$/.test(cells[1] || '') && cells[2]) {
        assumedRank = Number(cells[1]);
        rowName = cells[2];
      } else if (/^\d{1,2}$/.test(cells[0] || '') && cells[1]) {
        legacyNo = Number(cells[0]);
        rowName = cells[1];
      } else {
        continue;
      }

      const resultEvidence = cells.some((cell) => /\b\d{1,2}\.\d{2}\.\d{2}\b/.test(cell));
      if (!resultEvidence) assumedRank = null;
      const resultPlaceMatch = resultEvidence ? rowName.match(/\((\d{1,2})\)/) : null;
      if (resultPlaceMatch && !Number.isFinite(assumedRank)) assumedRank = Number(resultPlaceMatch[1]);
      const horseMatch = rowName.match(/\((\d{1,2})\)/);
      horseNumber = horseMatch ? Number(horseMatch[1]) : legacyNo;
      const name = rowName.replace(/\s*\(\d{1,2}\).*$/, '').replace(/\s+(?:KG|K|DB|SKG|SK)\b.*$/i, '').trim();
      if (!name) continue;
      const origin = cells.find((cell, index) => index > 1 && /[-–—].*\//.test(cell)) || '';
      const pedigree = parseOrigin(origin);
      const weight = parseNumber(cells.find((cell) => /^\d{2}(?:[.,]\d)?(?:\s*\+\s*\d+(?:[.,]\d+)?)?/.test(cell)));
      const agfText = cells.find((cell) => /%\s*\d/.test(cell)) || '';
      const agfMatch = agfText.match(/%\s*(\d+(?:[.,]\d+)?)/);
      const age = cells.find((cell) => /^\d+y\s+[a-z]\s+[a-z]$/i.test(cell)) || '';
      const form = cells.find((cell) => /^\d{3,6}$/.test(cell)) || '';
      const jockey = '';
      current.horses.push({
        no: horseNumber,
        horseNumber,
        name,
        sire: pedigree.sire,
        dam: pedigree.dam,
        damSire: pedigree.damSire,
        origin,
        age,
        weight,
        handicapPoints: null,
        programStartNumber: null,
        jockey,
        form,
        agf: agfMatch ? Number(agfMatch[1].replace(',', '.')) : null,
        odds: null,
        scratched: /koşmaz|scratched/i.test(rowName),
        rank: Number.isFinite(assumedRank) ? assumedRank : 0
      });
    }

    if (current) races.push(current);
    for (const race of races) {
      const activeHorses = race.horses.filter((horse) => !horse.scratched);
      const rowNumbersAreSequential = race.horses.every((horse, index) => horse.bulletinRowNumber === index + 1);
      const printedNumbers = activeHorses.map((horse) => horse.parentheticalHorseNumber);
      const printedNumbersAreComplete = printedNumbers.length > 0
        && printedNumbers.every((number) => Number.isSafeInteger(number) && number > 0)
        && new Set(printedNumbers).size === activeHorses.length
        && printedNumbers.every((number) => number <= activeHorses.length);
      if (rowNumbersAreSequential && printedNumbersAreComplete) {
        for (const horse of activeHorses) {
          horse.horseNumber = horse.parentheticalHorseNumber;
          horse.no = horse.parentheticalHorseNumber;
        }
      }
    }
    return races.filter((race) => race.horses.length > 0);
  }

  return { parseRaces, parseRaceConditions };
});
