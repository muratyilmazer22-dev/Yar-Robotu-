const CATEGORIES = ['banko', 'favorite', 'place', 'rival', 'surprise'];

function normalizeCity(value) {
  return String(value || '').toLocaleUpperCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'I').replace(/[^A-Z0-9]/g, '');
}

function raceKey(date, city, raceNo) {
  const raceDate = String(date || '').slice(0, 10);
  const number = Number(raceNo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate) || !normalizeCity(city) || !Number.isSafeInteger(number) || number < 1 || number > 30) return null;
  return `${raceDate}:${normalizeCity(city)}:${number}`;
}

function cleanSignals(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const output = {};
  for (const category of CATEGORIES) {
    const values = input[category];
    if (!Array.isArray(values)) continue;
    const numbers = [...new Set(values.map(Number).filter((number) => Number.isSafeInteger(number) && number >= 1 && number <= 30))].slice(0, 12);
    if (numbers.length) output[category] = numbers;
  }
  return Object.keys(output).length ? output : null;
}

function mergeSignals(target, source) {
  for (const category of CATEGORIES) {
    const merged = [...(Array.isArray(target[category]) ? target[category] : []), ...(Array.isArray(source[category]) ? source[category] : [])];
    const values = [...new Set(merged.map(Number).filter((number) => Number.isSafeInteger(number) && number > 0))];
    if (values.length) target[category] = values;
  }
  return target;
}

module.exports = { CATEGORIES, normalizeCity, raceKey, cleanSignals, mergeSignals };
