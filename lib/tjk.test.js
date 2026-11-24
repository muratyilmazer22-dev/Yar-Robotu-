const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRaceTables } = require('./tjk');

test('preserves weather, track condition, and announced surface changes from the bulletin', () => {
  const markup = `
    <div>Hava Durumu: Parçalı Bulutlu</div>
    <div>Pist Durumu: Islak</div>
    <div>Pist Değişikliği: Çim yerine sentetik pistte koşulacaktır.</div>
    <h2>1. Koşu 14:00 Maiden 1400 Kum</h2>
    <table><thead><tr><th>At İsmi</th></tr></thead><tbody><tr><td>KIR AT (1)</td></tr></tbody></table>`;
  const [race] = parseRaceTables(markup, 'program');
  assert.equal(race.weather, 'parcali bulutlu');
  assert.equal(race.trackCondition, 'islak');
  assert.equal(race.surfaceChange, 'cim yerine sentetik pistte kosulacaktir');
});

test('does not cap domestic hipodrom collection at twelve locations', () => {
  const links = Array.from({ length: 15 }, (_, index) => `<a data-sehir-id="${index + 1}" href="/TR/YarisSever/Info/Sehir/GunlukYarisProgrami?SehirId=${index + 1}">Hipodrom ${index + 1}</a>`).join('');
  assert.equal(require('./tjk').getDomesticCityLinks(links).length, 15);
});

test('extracts sire, dam, and damsire from official origin text', () => {
  const markup = `
    <h2>1. Koşu 14:00 Maiden 1400 Kum</h2>
    <table>
      <thead><tr><th>At İsmi</th><th>Orijin</th></tr></thead>
      <tbody><tr><td>KIR AT (1)</td><td>TOROK - ANNE ADI / LUXOR</td></tr></tbody>
    </table>`;
  const [race] = parseRaceTables(markup, 'program');

  assert.equal(race.runners[0].sire, 'TOROK');
  assert.equal(race.runners[0].dam, 'ANNE ADI');
  assert.equal(race.runners[0].damSire, 'LUXOR');
});

test('reads official race times from result tables', () => {
  const markup = `
    <h2>1. Koşu 14:00 Maiden 1400 Kum</h2>
    <table>
      <thead><tr><th>At İsmi</th><th>Derece</th><th>Sıra</th></tr></thead>
      <tbody><tr><td>KIR AT (1)</td><td>1.24.32</td><td>1</td></tr></tbody>
    </table>`;

  const [race] = parseRaceTables(markup, 'results');

  assert.equal(race.runners[0].time, '1.24.32');
  assert.equal(race.runners[0].finishPosition, 1);
});

test('does not infer official finish position from table row order', () => {
  const markup = `
    <h2>1. Koşu 14:00 Maiden 1400 Kum</h2>
    <table>
      <thead><tr><th>At İsmi</th><th>Derece</th></tr></thead>
      <tbody>
        <tr><td>KIR AT (1)</td><td>1.24.32</td></tr>
        <tr><td>AK AT (2)</td><td>1.25.10</td></tr>
      </tbody>
    </table>`;
  const [race] = parseRaceTables(markup, 'results');
  assert.deepEqual(race.runners.map((runner) => runner.finishPosition), [null, null]);
});

test('preserves explicit eküri codes from official race tables', () => {
  const markup = `
    <h2>1. Koşu 14:00 Maiden 1400 Kum</h2>
    <table>
      <thead><tr><th>At İsmi</th><th>Eküri</th><th>AGF</th></tr></thead>
      <tbody>
        <tr><td>KIR AT (1)</td><td>A</td><td>%24</td></tr>
        <tr><td>AK AT (2)</td><td>A</td><td>%10</td></tr>
      </tbody>
    </table>`;

  const [race] = parseRaceTables(markup, 'program');

  assert.deepEqual(race.runners.map((runner) => runner.couplingGroup), ['A', 'A']);
});
