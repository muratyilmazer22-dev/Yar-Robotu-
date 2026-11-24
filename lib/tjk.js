const cheerio = require('cheerio');

const ORIGIN = 'https://www.tjk.org';
function fold(value) {
  return String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/\s+/g, ' ').trim();
}

function classifyRaceType(value) {
  const type = fold(value);
  if (type.includes('handikap')) return 'Handikap';
  if (type.includes('maiden')) return 'Maiden';
  if (type.includes('sartli')) return 'Şartlı';
  if (/\bkv[\s-]*\d/.test(type) || type.includes('kisa vade')) return 'KV';
  if (type.includes('satis')) return 'Satış';
  if (type.includes('acik')) return 'Açık';
  return 'Tür belirtilmedi';
}

function formatTjkDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function assertOfficialHost(url) {
  const parsed = new URL(url, ORIGIN);
  if (parsed.origin !== ORIGIN) throw new Error('TJK returned a link outside its official domain.');
  return parsed.toString();
}

async function fetchHtml(url) {
  const safeUrl = assertOfficialHost(url);
  const response = await fetch(safeUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
      Referer: `${ORIGIN}/TR/YarisSever/Info/Page/GunlukYarisSonuclari`
    },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`TJK returned HTTP ${response.status}.`);
  return response.text();
}

function getLandingUrl(isoDate) {
  const url = new URL('/TR/YarisSever/Info/Page/GunlukYarisSonuclari', ORIGIN);
  const today = new Date().toISOString().slice(0, 10);
  url.searchParams.set('QueryParameter_Tarih', formatTjkDate(isoDate));
  url.searchParams.set('Era', isoDate < today ? 'past' : 'other');
  return url.toString();
}

function getDomesticCityLinks(markup) {
  const $ = cheerio.load(markup);
  const anchors = $('a[data-sehir-id]').toArray();
  const source = anchors.length ? anchors : $('a[href*="/Info/Sehir/GunlukYarisProgrami"],a[href*="/Info/Sehir/GunlukYarisSonuclari"]').toArray();
  const links = [];
  const seenCities = new Set();

  for (const anchor of source) {
    const label = $(anchor).text().replace(/\s+/g, ' ').trim();
    if (fold(label).startsWith('karma')) break;
    const href = $(anchor).attr('href');
    if (!href || !/GunlukYaris(?:Programi|Sonuclari)/i.test(href)) continue;
    const city = label.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!city) continue;
    const cityKey = fold(city);
    if (seenCities.has(cityKey)) continue;
    seenCities.add(cityKey);
    const officialUrl = assertOfficialHost(href);
    const isProgram = /GunlukYarisProgrami/i.test(officialUrl);
    links.push({ city, programUrl: isProgram ? officialUrl : officialUrl.replace('GunlukYarisSonuclari', 'GunlukYarisProgrami'), resultsUrl: isProgram ? officialUrl.replace('GunlukYarisProgrami', 'GunlukYarisSonuclari') : officialUrl });
  }

  return links;
}

function getHeaderText($, cell) {
  return fold($(cell).text()).replace(/[()]/g, '');
}

function parseDecimal(value) {
  const match = String(value || '').replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseRaceTables(markup, kind) {
  const $ = cheerio.load(markup);
  const races = new Map();
  const pageText = fold($('body').text());
  const conditionMatch = pageText.match(/(?:pist durumu|pist zemini|hava\s*\/\s*pist)\s*[:：\-]?\s*(cok agir|normal|islak|sulu|nemli|agir|hizli|yavas)\b/);
  const weatherMatch = pageText.match(/(?:hava durumu|hava)\s*[:：\-]\s*(parcali bulutlu|az bulutlu|gunesli|acik|bulutlu|kapali|yagmurlu|saganak|sisli|ruzgarli|kar yagisli|karli)\b/);
  const surfaceChangeMatch = pageText.match(/(?:pist|zemin|yaris)\s+degisikligi\s*[:：\-]\s*([^.!?]{2,120})/);
  const trackCondition = conditionMatch ? conditionMatch[1] : '';
  const weather = weatherMatch ? weatherMatch[1] : '';
  const surfaceChange = surfaceChangeMatch ? surfaceChangeMatch[1].trim() : '';
  const sequence = $('h1,h2,h3,h4,table').toArray();
  let activeNo = 0;
  let activeTitle = '';
  let activeRaceType = '';
  let activeRaceTime = '';

  for (const element of sequence) {
    const tagName = element.tagName.toLowerCase();
    if (tagName !== 'table') {
      const heading = $(element).text().replace(/\s+/g, ' ').trim();
      const raceMatch = fold(heading).match(/(\d{1,2})\s*\.?\s*kosu\b/);
      if (raceMatch) {
        activeNo = Number(raceMatch[1]);
        activeTitle = heading;
        activeRaceType = '';
        activeRaceTime = (heading.match(/\b\d{1,2}[.:]\d{2}\b/) || [])[0] || '';
      } else if (activeNo && /\b(sartli|maiden|handikap|kv[\s-]*\d|satis|acik|kisa vade)\b/i.test(fold(heading))) {
        activeRaceType = heading;
      } else if (activeNo && /\b(kum|cim|sentetik)\b/i.test(fold(heading))) {
        activeTitle = heading;
      }
      continue;
    }

    const table = $(element);
    const headerRow = table.find('thead tr').first().length ? table.find('thead tr').first() : table.find('tr').first();
    const headerCells = headerRow.find('th,td').toArray();
    const headers = headerCells.map((cell) => getHeaderText($, cell));
    const horseIndex = headers.findIndex((header) => header.includes('at ismi'));
    if (horseIndex < 0) continue;

    const bodyRows = table.find('tbody tr').length ? table.find('tbody tr').toArray() : table.find('tr').toArray().slice(1);
    const indexOf = (fragment) => headers.findIndex((header) => header.includes(fragment));
    const originIndex = indexOf('orijin');
    const weightIndex = indexOf('siklet');
    const jockeyIndex = indexOf('jokey');
    const ageIndex = indexOf('yas');
    const handicapIndex = headers.findIndex((header) => header === 'hp' || header.includes('handikap puan'));
    const startIndex = headers.findIndex((header) => header === 'st' || header.includes('start no'));
    const formIndex = indexOf('form');
    const agfIndex = indexOf('agf');
    const timeIndex = indexOf('derece');
    const oddsIndex = headers.findIndex((header) => header === 'gny' || header.includes('ganyan'));
    const rankIndex = headers.findIndex((header) => header === 's' || header.includes('sira') || header.includes('sonuc'));
    const couplingIndex = headers.findIndex((header) => header.includes('ekuri'));
    const number = activeNo || races.size + 1;
    if (!races.has(number)) {
      const distanceMatch = fold(`${activeRaceType} ${activeTitle}`).match(/(\d{3,4})\s*(kum|cim|sentetik)?/);
      races.set(number, {
        no: number,
        title: activeRaceType || `${number}. Koşu`,
        raceType: activeRaceType,
        raceCategory: classifyRaceType(activeRaceType),
        distance: distanceMatch ? Number(distanceMatch[1]) : null,
        surface: distanceMatch && distanceMatch[2] ? distanceMatch[2] : '',
        trackCondition,
        weather,
        surfaceChange,
        raceTime: activeRaceTime,
        runners: []
      });
    }

    const race = races.get(number);
    bodyRows.forEach((row, rowIndex) => {
      const cells = $(row).find('td').toArray();
      if (cells.length < headers.length || !cells[horseIndex]) return;
      const horseRaw = $(cells[horseIndex]).text().replace(/\s+/g, ' ').trim();
      const horseNumberMatch = horseRaw.match(/\((\d{1,2})\)/);
      const name = horseRaw.replace(/\s*\(\d{1,2}\).*$/, '').replace(/\s+(?:KG|K|DB|SKG|SK)\b.*$/i, '').trim();
      if (!name) return;

      const origin = originIndex >= 0 ? $(cells[originIndex]).text().replace(/\s+/g, ' ').trim() : '';
      const originParts = origin.split(/\s*[-–—]\s*/);
      const sire = (originParts[0] || '').trim();
      const damPart = originParts.slice(1).join(' - ');
      const damParts = damPart.split(/\s*\/\s*/);
      const dam = (damParts[0] || '').trim();
      const damSire = (damParts.slice(1).join(' / ') || '').trim();
      const agfText = agfIndex >= 0 ? $(cells[agfIndex]).text().trim() : '';
      const agfMatch = agfText.match(/%\s*(\d+(?:[.,]\d+)?)/);
      const rankValue = rankIndex >= 0 ? parseDecimal($(cells[rankIndex]).text()) : null;
      const age = ageIndex >= 0 ? $(cells[ageIndex]).text().replace(/\s+/g, ' ').trim() : '';
      const handicapPoints = handicapIndex >= 0 ? parseDecimal($(cells[handicapIndex]).text()) : null;
      const programStartNumber = startIndex >= 0 ? parseDecimal($(cells[startIndex]).text()) : null;
      const weightText = weightIndex >= 0 ? $(cells[weightIndex]).text() : '';
      const weight = parseDecimal(weightText);
      const gate = horseNumberMatch ? Number(horseNumberMatch[1]) : null;

      race.runners.push({
        name,
        no: gate,
        horseNumber: gate,
        sire,
        dam,
        damSire,
        origin,
        age,
        weight,
        handicapPoints,
        programStartNumber,
        jockey: jockeyIndex >= 0 ? $(cells[jockeyIndex]).text().replace(/\s+/g, ' ').trim() : '',
        couplingGroup: couplingIndex >= 0 ? $(cells[couplingIndex]).text().replace(/\s+/g, ' ').trim() : '',
        form: formIndex >= 0 ? $(cells[formIndex]).text().replace(/\s+/g, ' ').trim() : '',
        agf: agfMatch ? Number(agfMatch[1].replace(',', '.')) : 0,
        finishPosition: kind === 'results' ? (rankValue || rowIndex + 1) : null,
        time: timeIndex >= 0 ? $(cells[timeIndex]).text().replace(/\s+/g, ' ').trim() : '',
        odds: oddsIndex >= 0 ? parseDecimal($(cells[oddsIndex]).text()) : null,
        scratched: /kosmaz|scratched/i.test(horseRaw)
      });
    });
  }

  return Array.from(races.values()).filter((race) => race.runners.length > 0);
}

function resultUrlFromProgramUrl(programUrl) {
  const url = new URL(assertOfficialHost(programUrl));
  url.pathname = url.pathname.replace('GunlukYarisProgrami', 'GunlukYarisSonuclari');
  return url.toString();
}

async function importTjkDay(isoDate) {
  const landingUrl = getLandingUrl(isoDate);
  const landingHtml = await fetchHtml(landingUrl);
  const cityLinks = getDomesticCityLinks(landingHtml);
  if (!cityLinks.length) throw new Error('TJK did not list domestic racecourses for this date.');

  const records = [];
  const errors = [];
  const cityBatchSize = 3;
  for (let offset = 0; offset < cityLinks.length; offset += cityBatchSize) {
    const cityBatch = cityLinks.slice(offset, offset + cityBatchSize);
    const batchRecords = await Promise.all(cityBatch.map(async (cityLink) => {
      const resultsUrl = cityLink.resultsUrl || resultUrlFromProgramUrl(cityLink.programUrl);
      let programRaces = [];
      let resultRaces = [];
      await Promise.all([
        fetchHtml(cityLink.programUrl).then((html) => { programRaces = parseRaceTables(html, 'program'); }).catch((error) => errors.push(`${cityLink.city} program: ${error.message}`)),
        fetchHtml(resultsUrl).then((html) => { resultRaces = parseRaceTables(html, 'results'); }).catch((error) => errors.push(`${cityLink.city} results: ${error.message}`))
      ]);

      const programsByNo = new Map(programRaces.map((race) => [race.no, race]));
      const resultsByNo = new Map(resultRaces.map((race) => [race.no, race]));
      const raceNos = new Set([...programsByNo.keys(), ...resultsByNo.keys()]);
      return Array.from(raceNos, (raceNo) => {
        const programRace = programsByNo.get(raceNo);
        const resultRace = resultsByNo.get(raceNo);
        const meta = programRace || resultRace;
        return {
          raceNo,
          city: cityLink.city,
          program: programRace ? { schemaVersion: 2, title: programRace.title, raceType: programRace.raceType, raceCategory: programRace.raceCategory, distance: programRace.distance, surface: programRace.surface, trackCondition: programRace.trackCondition, weather: programRace.weather, surfaceChange: programRace.surfaceChange, raceTime: programRace.raceTime, runners: programRace.runners } : { schemaVersion: 2, title: meta.title, raceType: meta.raceType, raceCategory: meta.raceCategory, distance: meta.distance, surface: meta.surface, trackCondition: meta.trackCondition, weather: meta.weather, surfaceChange: meta.surfaceChange, raceTime: meta.raceTime, runners: [] },
          results: resultRace ? { runners: resultRace.runners } : { runners: [] },
          sourceUrls: { program: cityLink.programUrl, results: resultsUrl }
        };
      });
    }));
    records.push(...batchRecords.flat());
  }

  if (!records.length) throw new Error(errors[0] || 'No race tables were found on TJK for this date.');
  return { records, cities: cityLinks.map((link) => link.city), errors };
}

module.exports = { importTjkDay, parseRaceTables, getDomesticCityLinks };
