const { db, pool } = require('./lib/db');
const { raceHistory } = require('./lib/db/schema');
const { createQualityAuditRows, assessRaceQuality } = require('./lib/archive-quality');
const { raceHistoryAudit } = require('./lib/db/schema');
const { refreshAutomaticModel } = require('./lib/automatic-learning');
const { sql } = require('drizzle-orm');

const ORIGIN = 'https://www.tjk.org';
const TURKEY_CITY_IDS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
const REQUEST_DELAY_MS = 180;

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([\da-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)));
}

function textFromHtml(value) {
  return decodeEntities(String(value || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/[\u00a0\s]+/g, ' ').trim();
}

function numeric(value) {
  const match = String(value || '').replace(/\s/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function dateToTjk(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}%2F${month}%2F${year}`;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getIstanbulToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function threeMonthsAgo(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const targetMonthIndex = year * 12 + month - 1 - 3;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12 + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

async function getPage(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'YarisRobot historical results importer/1.0', Accept: 'text/html' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`TJK returned HTTP ${response.status} for ${new URL(url).pathname}`);
  return response.text();
}

function parseCityLinks(indexHtml) {
  const links = [];
  const pattern = /<a\b([^>]*\bdata-sehir-id="(\d+)"[^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of indexHtml.matchAll(pattern)) {
    const [, attributes, cityId, labelHtml] = match;
    if (!TURKEY_CITY_IDS.has(cityId)) continue;
    const href = attributes.match(/\bhref="([^"]+)"/i)?.[1];
    if (!href) continue;
    links.push({ cityId, city: textFromHtml(labelHtml).replace(/\s*\([^)]*\)\s*$/, ''), url: `${ORIGIN}${decodeEntities(href)}` });
  }
  return links;
}

function parseRacePage(html, raceDate, city, sourceUrl) {
  const races = [];
  const sections = /<div\b[^>]*\bid="(\d+)"[^>]*\bsehir="([^"]+)"[^>]*>([\s\S]*?)(?=<div\b[^>]*\bid="\d+"[^>]*\bsehir=|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/gi;
  const sectionMatches = [...html.matchAll(sections)];
  const blocks = sectionMatches.length ? sectionMatches.map((match) => match[3]) : [html];

  for (const block of blocks) {
    const title = textFromHtml(block.match(/<h3\b[^>]*class="race-no"[^>]*>[\s\S]*?<a\b[^>]*>[\s\S]*?<\/a>[\s\S]*?<\/h3>/i)?.[0] || '');
    const number = Number(title.match(/(\d+)\s*\.\s*Koşu/i)?.[1]);
    if (!Number.isSafeInteger(number) || number < 1) continue;

    const config = textFromHtml(block.match(/<h3\b[^>]*class="race-config"[^>]*>[\s\S]*?<\/h3>/i)?.[0] || '');
    const raceType = config.split(',')[0]?.trim() || '';
    const distanceMatch = config.match(/\b(\d{3,4})\s*(Kum|Çim|Sentetik)\b/i);
    const table = block.match(/<table\b[^>]*summary="Kosular"[^>]*>([\s\S]*?)<\/table>/i)?.[1];
    if (!table) continue;

    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => textFromHtml(cell[1]))
    ).filter((row) => row.length >= 12);
    if (!rows.length) continue;

    const runners = [];
    const resultRunners = [];
    for (const row of rows) {
      const finishPosition = numeric(row[1]);
      const nameCell = row[2] || '';
      const numberMatch = nameCell.match(/\((\d{1,2})\)/);
      const horseNumber = numberMatch ? Number(numberMatch[1]) : null;
      const name = nameCell.replace(/\(\d{1,2}\)/g, '').replace(/\s+(?:KG|K|DB|SKG|SK|GKR)\b.*$/i, '').replace(/\s+\(Koşmaz\).*$/i, '').trim();
      if (!Number.isSafeInteger(horseNumber) || horseNumber < 1 || !name || /\(Koşmaz\)/i.test(nameCell)) continue;
      const origin = row[4] || '';
      const pedigree = origin.split(/\s*[-–—]\s*/);
      const damLine = (pedigree.slice(1).join(' - ') || '').split(/\s*\/\s*/);
      const runner = {
        horseNumber,
        no: horseNumber,
        name,
        age: row[3] || '',
        origin,
        sire: (pedigree[0] || '').trim(),
        dam: (damLine[0] || '').trim(),
        damSire: (damLine[1] || '').trim(),
        weight: numeric(row[5]),
        jockey: row[6] || '',
        handicapPoints: numeric(row[15]),
        agf: numeric(row[11]),
        form: '',
        scratched: false
      };
      runners.push(runner);
      if (Number.isSafeInteger(finishPosition) && finishPosition > 0) {
        resultRunners.push({ horseNumber, no: horseNumber, finishPosition, odds: numeric(row[10]) });
      }
    }
    if (runners.length < 2 || !resultRunners.some((runner) => runner.finishPosition === 1)) continue;

    const surface = distanceMatch?.[2] || '';
    const record = {
      raceDate,
      city,
      raceNo: number,
      program: {
        title: raceType,
        raceType,
        distance: distanceMatch ? Number(distanceMatch[1]) : null,
        surface,
        runners
      },
      results: { runners: resultRunners },
      sourceUrls: { tjk: sourceUrl }
    };
    const quality = assessRaceQuality(record);
    if (quality.status === 'complete') races.push(record);
  }
  return races;
}

async function importArchive({ now = new Date(), startDate = null, endDate = null } = {}) {
  const to = endDate || getIstanbulToday(now);
  const from = startDate || threeMonthsAgo(to);
  if (from > to) throw new Error('Start date must not be after end date.');

  const records = [];
  const warnings = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    try {
      const indexUrl = `${ORIGIN}/TR/YarisSever/Info/Page/GunlukYarisSonuclari?QueryParameter_Tarih=${dateToTjk(date)}`;
      const indexHtml = await getPage(indexUrl);
      const cityLinks = parseCityLinks(indexHtml);
      for (const link of cityLinks) {
        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
        try {
          const html = await getPage(link.url);
          records.push(...parseRacePage(html, date, link.city, link.url));
        } catch (error) {
          warnings.push(`${date} ${link.city}: ${error.message}`);
        }
      }
    } catch (error) {
      warnings.push(`${date}: ${error.message}`);
    }
    if ((new Date(`${date}T12:00:00.000Z`).getUTCDate() === 1) || date === to) {
      console.log(`[import] ${date}: parsed ${records.length} complete races so far`);
    }
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  }

  if (!records.length) {
    throw new Error(`No complete local TJK race results were fetched for ${from} through ${to}; nothing was written to the archive.`);
  }

  const inserted = [];
  for (let offset = 0; offset < records.length; offset += 100) {
    const batch = records.slice(offset, offset + 100);
    const saved = await db.insert(raceHistory).values(batch).onConflictDoNothing().returning({ raceDate: raceHistory.raceDate, city: raceHistory.city, raceNo: raceHistory.raceNo });
    inserted.push(...saved);
  }

  if (inserted.length) {
    const insertedKeys = new Set(inserted.map((row) => `${row.raceDate}|${row.city}|${row.raceNo}`));
    const insertedRecords = records.filter((row) => insertedKeys.has(`${row.raceDate}|${row.city}|${row.raceNo}`));
    const audits = insertedRecords.flatMap((record) => createQualityAuditRows(
      record.raceDate,
      [record],
      warnings.filter((warning) => warning.startsWith(`${record.raceDate} `)),
      'tjk_official_historical_backfill'
    ));
    for (let offset = 0; offset < audits.length; offset += 100) {
      await db.insert(raceHistoryAudit).values(audits.slice(offset, offset + 100));
    }
  }

  console.log(JSON.stringify({ from, to, fetchedCompleteRaces: records.length, insertedRaces: inserted.length, existingRacesSkipped: records.length - inserted.length, needsReview: records.filter((row) => assessRaceQuality(row).status !== 'complete').length, warningCount: warnings.length, warningSamples: warnings.slice(0, 10) }, null, 2));

  if (inserted.length) {
    const model = await refreshAutomaticModel({ database: db, now });
    console.log(JSON.stringify({ modelRefresh: { runId: model.runId, refreshedAt: model.refreshedAt, report: model.report } }, null, 2));
  } else {
    const [count] = await db.select({ count: sql`count(*)::int` }).from(raceHistory);
    console.log(JSON.stringify({ modelRefresh: 'Skipped because no new races were inserted', archiveRaceCount: count.count }));
  }
}

if (require.main === module) {
  importArchive().catch((error) => {
    console.error('[import] TJK backfill failed:', error?.code || error?.message || 'UNKNOWN_ERROR');
    process.exitCode = 1;
  }).finally(async () => {
    await pool.end().catch(() => {});
  });
}

module.exports = { decodeEntities, textFromHtml, dateToTjk, threeMonthsAgo, parseCityLinks, parseRacePage, importArchive };
