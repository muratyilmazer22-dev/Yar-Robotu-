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

  function splitCells(line) {
    if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
    if (line.includes('|')) return line.split('|').map((cell) => cell.trim());
    return null;
  }

  function parseOrigin(origin) {
    const parts = String(origin || '').split(/\s*[-–—]\s*/);
    const sire = (parts[0] || '').trim();
    const damLine = parts.slice(1).join(' - ');
    const damSire = (damLine.split(/\s*\/\s*/).slice(1).join(' / ') || '').trim();
    return { sire, damSire };
  }

  function parseRaces(text) {
    const races = [];
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
          distance: distanceMatch ? Number(distanceMatch[1]) : 1400,
          surface: distanceMatch?.[2] || 'Belirtilmedi',
          horses: []
        };
        headers = null;
        continue;
      }
      if (!current) continue;

      const cells = splitCells(raw);
      if (!cells) continue;
      const normalizedHeaders = cells.map(fold);
      const nameIndex = normalizedHeaders.findIndex((cell) => cell.includes('at ismi') || cell === 'at adi' || cell === 'at' || cell.includes('horse name') || cell === 'horse' || cell === 'runner');
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
        const horseCellIndex = headers.findIndex((header) => header.includes('at ismi') || header === 'at adi' || header === 'at' || header.includes('horse name') || header === 'horse' || header === 'runner');
        rowName = cells[horseCellIndex] || '';
        const horseMatch = rowName.match(/\((\d{1,2})\)/) || rowName.match(/^\s*(\d{1,2})\s*[-–.)]\s*/);
        const column = (fragment) => {
          const index = indexOf(fragment);
          return index >= 0 ? cells[index] || '' : '';
        };
        const numberIndex = headers.findIndex((header) => header === 'no' || header.includes('at no') || header.includes('horse no') || header.includes('horse number') || header.includes('program no'));
        horseNumber = horseMatch ? Number(horseMatch[1]) : numberIndex >= 0 ? parseNumber(cells[numberIndex]) : null;
        const rankIndex = headers.findIndex((header) => header === 's' || header.includes('sira') || header.includes('sonuc') || header.includes('result') || header.includes('rank') || header.includes('placing') || header.includes('position'));
        assumedRank = rankIndex >= 0 ? parseNumber(cells[rankIndex]) : null;
        const origin = column('orijin');
        const pedigree = parseOrigin(origin);
        const weightText = column('siklet');
        const agfText = column('agf');
        const agfMatch = agfText.match(/%\s*(\d+(?:[.,]\d+)?)/);
        const form = column('form');
        const age = column('yas');
        const jockey = column('jokey');
        const handicapPoints = parseNumber(column('hp'));
        const programStartNumber = parseNumber(column('st'));
        const odds = parseNumber(column('gny'));
        const weight = parseNumber(weightText);
        const name = rowName.replace(/\s*\(\d{1,2}\).*$/, '').replace(/^\s*\d{1,2}\s*[-–.)]\s*/, '').replace(/\s+(?:KG|K|DB|SKG|SK)\b.*$/i, '').trim();
        if (!name) continue;
        current.horses.push({
          no: horseNumber,
          horseNumber,
          name,
          sire: pedigree.sire,
          damSire: pedigree.damSire,
          origin,
          age,
          weight,
          handicapPoints,
          programStartNumber,
          jockey,
          form,
          agf: agfMatch ? Number(agfMatch[1].replace(',', '.')) : 0,
          odds,
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
        damSire: pedigree.damSire,
        origin,
        age,
        weight,
        handicapPoints: null,
        programStartNumber: null,
        jockey,
        form,
        agf: agfMatch ? Number(agfMatch[1].replace(',', '.')) : 0,
        odds: null,
        scratched: /koşmaz|scratched/i.test(rowName),
        rank: Number.isFinite(assumedRank) ? assumedRank : 0
      });
    }

    if (current) races.push(current);
    return races.filter((race) => race.horses.length > 0);
  }

  return { parseRaces };
});
