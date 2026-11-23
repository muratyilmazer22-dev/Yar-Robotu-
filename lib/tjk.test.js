const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRaceTables } = require('./tjk');

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
