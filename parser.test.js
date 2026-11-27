const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRaces, parseRaceConditions } = require('./parser');

test('extracts weather and surface-change notes from the bulletin text', () => {
  const conditions = parseRaceConditions('Hava Durumu: Parçalı Bulutlu\nPist Durumu: Islak\nPist Değişikliği: Çim yerine sentetik pistte koşulacaktır');
  assert.deepEqual(conditions, { weather: 'parcali bulutlu', trackCondition: 'islak', surfaceChange: 'cim yerine sentetik pistte kosulacaktir' });
});

test('attaches bulletin conditions to every parsed race', () => {
  const [race] = parseRaces('Hava: Yağmurlu\nPist Zemini: Ağır\n1. Koşu 14:00 Maiden 1400 Kum\nAt İsmi\tHP\nKIR AT (1)\t60');
  assert.equal(race.weather, 'yagmurlu');
  assert.equal(race.trackCondition, 'agir');
});

test('leaves missing distance unknown instead of assuming 1400 meters', () => {
  const [race] = parseRaces([
    '1. Koşu 14:00 Maiden',
    'At İsmi\tAGF\tGNY',
    'KIR AT (1)\t24\t2,40'
  ].join('\n'));
  assert.equal(race.distance, null);
  assert.equal(race.horses[0].agf, 24);
});

test('parses tabular race bulletins by their column headers', () => {
  const bulletin = [
    '1. Koşu 14:00 Maiden 1400 Kum',
    'At İsmi\tHP\tAGF\tGNY\tForm\tOrijin',
    'KIR AT (1)\t72\t%24\t2,40\t112321\tTOROK - ANOTHER / LUXOR',
    'AK AT (2)\t55\t%10\t5,20\t223451\tMENDIP - EXAMPLE / KAIZBERT'
  ].join('\n');

  const [race] = parseRaces(bulletin);

  assert.equal(race.no, 1);
  assert.equal(race.distance, 1400);
  assert.equal(race.surface, 'Kum');
  assert.equal(race.horses.length, 2);
  assert.equal(race.horses[0].horseNumber, 1);
  assert.equal(race.horses[0].handicapPoints, 72);
  assert.equal(race.horses[0].agf, 24);
  assert.equal(race.horses[0].odds, 2.4);
  assert.equal(race.horses[0].form, '112321');
  assert.equal(race.horses[0].sire, 'TOROK');
  assert.equal(race.horses[0].dam, 'ANOTHER');
  assert.equal(race.horses[0].damSire, 'LUXOR');
  assert.equal(race.horses[0].rank, 0);
});

test('parses KGS as days since the horse last raced and leaves missing values unknown', () => {
  const bulletin = [
    '1. Koşu 14:00 Maiden 1400 Kum',
    'At No\tAt İsmi\tKGS\tHP',
    '1\tKIR AT\t28\t72',
    '2\tAK AT\t—\t55'
  ].join('\n');

  const [race] = parseRaces(bulletin);

  assert.equal(race.horses[0].daysSinceLastRace, 28);
  assert.equal(race.horses[1].daysSinceLastRace, null);
});

test('uses a compact At header as the horse name instead of the AGF column', () => {
  const bulletin = [
    '4. Koşu 13:30 Handikap 17 2100 Kum',
    'At No\tAt\tAGF\tGNY',
    '8\tKARA AT\t%5\t3,20',
    '7\tAK RÜZGAR\t%8\t4,10'
  ].join('\n');

  const [race] = parseRaces(bulletin);

  assert.deepEqual(race.horses.map((horse) => ({ number: horse.horseNumber, name: horse.name, agf: horse.agf })), [
    { number: 8, name: 'KARA AT', agf: 5 },
    { number: 7, name: 'AK RÜZGAR', agf: 8 }
  ]);
});

test('reads the official compact N column as the horse number', () => {
  const bulletin = [
    '1. Koşu 13:30 Handikap 17 2100 Kum',
    'N\tAt İsmi\tSıra\tDerece',
    '1\tMY CHAKRA (10) KG DB SK\t1\t1.23.45',
    '2\tAK RÜZGAR (3) KG\t2\t1.24.10'
  ].join('\n');

  const [race] = parseRaces(bulletin);

  assert.deepEqual(race.horses.map((horse) => [horse.horseNumber, horse.name, horse.rank]), [
    [1, 'MY CHAKRA', 1],
    [2, 'AK RÜZGAR', 2]
  ]);
});

test('keeps the program horse number separate from the starting stall', () => {
  const bulletin = [
    '1. Koşu 13:30 Handikap 17 2100 Kum',
    'At İsmi\tSt\tHP\tAGF\tGNY\tForm\tOrijin',
    '1 - STEEL STRONG\t2\t80\t%34.93\t1.95\t2111\tTOROK - EXAMPLE / LUXOR',
    '2 - RICO PASHA\t3\t79\t%10.35\t5.50\t7343\tMENDIP - EXAMPLE / KAIZBERT'
  ].join('\n');

  const [race] = parseRaces(bulletin);

  assert.deepEqual(race.horses.map((horse) => ({ number: horse.horseNumber, no: horse.no, name: horse.name, stall: horse.programStartNumber })), [
    { number: 1, no: 1, name: 'STEEL STRONG', stall: 2 },
    { number: 2, no: 2, name: 'RICO PASHA', stall: 3 }
  ]);
});

test('reads explicit eküri group codes from the bulletin', () => {
  const bulletin = [
    '1. Koşu 14:00 Maiden 1400 Kum',
    'At No\tAt İsmi\tEküri\tAGF',
    '1\tKIR AT\tA\t%24',
    '2\tAK AT\tA\t%10',
    '3\tYEL AT\tB\t%8'
  ].join('\n');

  const [race] = parseRaces(bulletin);

  assert.deepEqual(race.horses.map((horse) => horse.couplingGroup), ['A', 'A', 'B']);
});

test('does not substitute starting stall for an unknown horse number', () => {
  const bulletin = [
    '1. Koşu 13:30 Handikap 17 2100 Kum',
    'At İsmi\tSt\tHP',
    'STEEL STRONG\t2\t80'
  ].join('\n');

  const [race] = parseRaces(bulletin);

  assert.equal(race.horses[0].horseNumber, null);
  assert.equal(race.horses[0].no, null);
  assert.equal(race.horses[0].programStartNumber, 2);
});

test('reads finishing positions from result-table headers', () => {
  const results = [
    '1. Koşu 14:00 Maiden 1400 Kum',
    'At İsmi\tSıra\tDerece',
    'KIR AT (1)\t1\t1.23.45',
    'AK AT (2)\t2\t1.24.10'
  ].join('\n');

  const [race] = parseRaces(results);

  assert.deepEqual(race.horses.map((horse) => horse.rank), [1, 2]);
});

test('does not use a horse number as a finish position when result rank is absent', () => {
  const results = [
    '3. Koşu 15:30 Maiden',
    'N\tAt İsmi',
    '9\tBY NALÇAKAN',
    '3\tDJUMBO'
  ].join('\n');
  const [race] = parseRaces(results);
  assert.deepEqual(race.horses.map((horse) => horse.rank), [0, 0]);
});

test('does not mistake parenthesized program numbers for finishing positions', () => {
  const program = [
    '1. Koşu 15:00 Şartlı 2 1400 Kum',
    'N\tAt İsmi\tYaş\tOrijin\tSıklet\tJokey\tSt\tHP\tSon 6 Y.\tKGS\ts20\tEn İyi D.\tGny\tAGF',
    '1\tKÜÇÜK HASO (1) KG DB SK\t3y k e\tAKARÇAY - HANIMZEYNO / HABERBATUR\t56\tE.AKPINAR\t1\t38\t655008\t8\t13\t1.50.56\t3,30\t%4',
    '3\tBAŞ YARGIÇ (2) K DB GKR\t3y a e\tGÜMBÜRGÜMBÜR - ŞIPSEVDİ / HABERBATUR\t57\tH.ŞİMŞEK\t4\t27\t073453\t7\t17\t1.39.20\t1,35\t%20'
  ].join('\n');

  const [race] = parseRaces(program);

  assert.deepEqual(race.horses.map((horse) => [horse.horseNumber, horse.name, horse.rank]), [
    [1, 'KÜÇÜK HASO', 0],
    [3, 'BAŞ YARGIÇ', 0]
  ]);
});

test('reads winner rank from result tables without a time column', () => {
  const results = [
    '3. Koşu 15:30 Maiden',
    'At No\tAt İsmi\tSıra',
    '9\tPEER KING\t1',
    '3\tDJUMBO\t2'
  ].join('\n');

  const [race] = parseRaces(results);

  assert.deepEqual(race.horses.map((horse) => [horse.horseNumber, horse.rank]), [[9, 1], [3, 2]]);
});

test('supports English race headings and result column names', () => {
  const results = [
    '1. Race 10:15 Selangor',
    'Horse No\tHorse Name\tPosition',
    '2\tPACIFIC SILVER\t1',
    '3\tANIKI\t2'
  ].join('\n');

  const [race] = parseRaces(results);

  assert.equal(race.no, 1);
  assert.deepEqual(race.horses.map((horse) => [horse.horseNumber, horse.rank]), [[2, 1], [3, 2]]);
});

test('does not treat a generic one-letter S program column as finishing positions', () => {
  const program = [
    '2. Koşu 14:00 Handikap 1400 Kum',
    'At No\tAt İsmi\tS\tAGF',
    '1\tKIR AT\t1\t%24',
    '2\tAK AT\t2\t%10'
  ].join('\n');

  const [race] = parseRaces(program);

  assert.deepEqual(race.horses.map((horse) => horse.rank), [0, 0]);
});

test('recognizes an abbreviated S result column only when the table also has a result time', () => {
  const results = [
    '2. Koşu 14:00 Handikap 1400 Kum',
    'At No\tAt İsmi\tS\tDerece',
    '1\tKIR AT\t1\t1.23.45',
    '2\tAK AT\t2\t1.24.10'
  ].join('\n');

  const [race] = parseRaces(results);

  assert.deepEqual(race.horses.map((horse) => horse.rank), [1, 2]);
});

test('ignores percentage-only cells instead of treating them as unnamed runners', () => {
  const bulletin = [
    '1. Koşu 14:00 Maiden 1400 Kum',
    'At İsmi\tAGF\tHP',
    'KIR AT (1)\t%24\t72',
    '%18\t%18\t0'
  ].join('\n');

  const [race] = parseRaces(bulletin);

  assert.deepEqual(race.horses.map((horse) => [horse.horseNumber, horse.name]), [[1, 'KIR AT']]);
});

test('reads the horse number when the compact N and horse-name headers are pasted together', () => {
  const bulletin = [
    '7. Koşu 21:30 Maiden 1400 Kum',
    'N At İsmi\tYaş\tSıklet',
    '1 ATAERİ KG SK\t3y d e\t62',
    '2 BESNİ KG DB\t3y a e\t61',
    '3 KÜÇÜK ŞOVALYE KG DB SK\t3y k e\t57'
  ].join('\n');

  const [race] = parseRaces(bulletin);

  assert.deepEqual(race.horses.map((horse) => [horse.horseNumber, horse.name]), [
    [1, 'ATAERİ'],
    [2, 'BESNİ'],
    [3, 'KÜÇÜK ŞOVALYE']
  ]);
});

test('keeps the first and second race legs separate at their numbered headings', () => {
  const bulletin = [
    '1. Koşu 14:00 Maiden 1400 Kum',
    'At No\tAt İsmi\tAGF',
    '1\tBİRİNCİ AT\t%24',
    '2. Koşu 14:30 Handikap 1600 Çim',
    'At No\tAt İsmi\tAGF',
    '4\tİKİNCİ AT\t%12'
  ].join('\n');

  const races = parseRaces(bulletin);

  assert.deepEqual(races.map((race) => ({
    no: race.no,
    distance: race.distance,
    surface: race.surface,
    horses: race.horses.map((horse) => horse.name)
  })), [
    { no: 1, distance: 1400, surface: 'Kum', horses: ['BİRİNCİ AT'] },
    { no: 2, distance: 1600, surface: 'Çim', horses: ['İKİNCİ AT'] }
  ]);
});
