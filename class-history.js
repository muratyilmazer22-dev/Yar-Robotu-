(() => {
  const panel = document.getElementById('panel-sinif');
  if (!panel) return;

  const status = document.getElementById('classHistoryStatus');
  const queryInput = document.getElementById('classHorseSearch');
  const citySelect = document.getElementById('classCityFilter');
  const horseSelect = document.getElementById('classHorseSelect');
  const results = document.getElementById('classHistoryResults');
  let archive = [];
  let loaded = false;
  let loading = false;

  const fold = (value) => String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
  const formatDate = (value) => {
    const date = new Date(`${String(value || '').slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? 'Tarih yok' : new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  };
  const classRank = (row) => {
    const text = fold(row.program?.raceType || row.program?.raceCategory || '');
    const numbered = text.match(/(?:handikap|kv|sartli)\s*(\d{1,2})/);
    if (numbered) return Number(numbered[1]);
    if (text.includes('acik') || text.includes('grup')) return 30;
    if (text.includes('kv')) return 25;
    if (text.includes('handikap')) return 20;
    if (text.includes('sartli')) return 15;
    if (text.includes('satis')) return 10;
    if (text.includes('maiden')) return 5;
    return null;
  };
  const className = (row) => {
    const value = String(row.program?.raceType || row.program?.raceCategory || '').trim();
    if (!value) return 'Tür belirtilmedi';
    const concise = value.match(/(?:Handikap\s*\d+(?:\/[A-Z0-9]+)?|Şartlı\s*\d+(?:\/[A-Z0-9]+)?|KV\s*[- ]?\d+|Maiden|Satış|Açık|Grup\s*\d+)/i);
    return concise ? concise[0] : value.split(',')[0].trim();
  };
  const handicapValue = (runner) => runner.handicapPoints === null || runner.handicapPoints === undefined || runner.handicapPoints === '' ? null : Number.isFinite(Number(runner.handicapPoints)) ? Number(runner.handicapPoints) : null;
  const runners = () => archive.flatMap((row) => (Array.isArray(row.program?.runners) ? row.program.runners : []).map((runner) => ({ row, runner })))
    .filter(({ runner }) => runner.name && !runner.scratched);

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function renderHorseOptions() {
    const search = fold(queryInput.value);
    const city = citySelect.value;
    const groups = new Map();
    for (const { row, runner } of runners()) {
      if (city && row.city !== city) continue;
      const key = fold(runner.name);
      if (!key || !key.includes(search)) continue;
      const group = groups.get(key) || { name: runner.name, starts: 0, latest: '' };
      group.starts += 1;
      if (String(row.race_date) > group.latest) group.latest = String(row.race_date);
      groups.set(key, group);
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1].starts - a[1].starts || b[1].latest.localeCompare(a[1].latest) || a[1].name.localeCompare(b[1].name, 'tr'));
    const previous = horseSelect.value;
    horseSelect.replaceChildren(new Option(sorted.length ? 'At seçin…' : 'Eşleşen at bulunamadı', ''));
    for (const [key, group] of sorted.slice(0, 250)) {
      const option = new Option(`${group.name} · ${group.starts} kayıt`, key);
      horseSelect.append(option);
    }
    if (sorted.some(([key]) => key === previous)) horseSelect.value = previous;
    else results.replaceChildren();
  }

  function renderHorseHistory() {
    const selected = horseSelect.value;
    if (!selected) {
      results.replaceChildren();
      return;
    }
    const city = citySelect.value;
    const history = runners().filter(({ row, runner }) => fold(runner.name) === selected && (!city || row.city === city))
      .sort((a, b) => String(a.row.race_date).localeCompare(String(b.row.race_date)) || Number(a.row.race_no) - Number(b.row.race_no));
    const deduplicated = history.filter((item, index) => index === 0 || `${item.row.race_date}|${item.row.city}|${item.row.race_no}` !== `${history[index - 1].row.race_date}|${history[index - 1].row.city}|${history[index - 1].row.race_no}`);
    if (!deduplicated.length) {
      results.textContent = 'Bu at için arşivde yeterli kayıt bulunamadı.';
      return;
    }

    const first = deduplicated[0];
    const last = deduplicated.at(-1);
    const firstHp = handicapValue(first.runner);
    const lastHp = handicapValue(last.runner);
    const hpChange = firstHp !== null && lastHp !== null ? lastHp - firstHp : null;
    const firstRank = classRank(first.row);
    const lastRank = classRank(last.row);
    const shift = firstRank !== null && lastRank !== null ? lastRank - firstRank : null;
    const overview = document.createElement('div');
    overview.className = 'class-history-overview';
    const movement = shift === null ? 'Sınıf kıyası için tür bilgisi eksik' : shift > 0 ? 'Daha üst kategoriye çıkış' : shift < 0 ? 'Daha alt kategoriye iniş' : 'Kategori seviyesi aynı';
    const metrics = [
      ['Arşiv startı', String(deduplicated.length)],
      ['İlk kategori', className(first.row)],
      ['Son kategori', className(last.row)],
      ['Sınıf hareketi', movement],
      ['HP değişimi', hpChange === null ? '—' : `${hpChange > 0 ? '+' : ''}${hpChange.toLocaleString('tr-TR')}`]
    ];
    for (const [label, value] of metrics) {
      const item = document.createElement('div');
      item.className = 'class-history-metric';
      const title = document.createElement('span');
      title.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = value;
      item.append(title, strong);
      overview.append(item);
    }

    const note = document.createElement('p');
    note.className = 'sub class-history-note';
    note.textContent = 'Kategori kıyası TJK yarış türü etiketlerinden yaklaşık çıkarılır; Handikap/KV numarası varsa doğrudan karşılaştırılır. HP değişimi yalnızca arşivdeki ilk ve son ölçüm arasındadır.';
    const heading = document.createElement('h3');
    heading.textContent = 'Koşu geçmişi';
    const list = document.createElement('ol');
    list.className = 'class-history-list';
    for (const [index, item] of [...deduplicated].reverse().entries()) {
      const prior = deduplicated[deduplicated.length - 2 - index];
      const previousRank = prior ? classRank(prior.row) : null;
      const currentRank = classRank(item.row);
      const currentHp = handicapValue(item.runner);
      const previousHp = prior ? handicapValue(prior.runner) : null;
      const delta = currentHp !== null && previousHp !== null ? currentHp - previousHp : null;
      let movementLabel = 'İlk kayıt';
      if (prior && previousRank !== null && currentRank !== null) movementLabel = currentRank > previousRank ? 'Sınıf yükseldi' : currentRank < previousRank ? 'Sınıf düştü' : 'Sınıf aynı';
      const li = document.createElement('li');
      li.className = 'class-history-entry';
      const detail = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = `${item.row.city || 'Hipodrom'} · ${Number(item.row.race_no) || '—'}. koşu`;
      const meta = document.createElement('span');
      meta.textContent = `${formatDate(item.row.race_date)} · ${className(item.row)}`;
      detail.append(strong, meta);
      const badge = document.createElement('span');
      badge.className = 'class-history-badge';
      badge.textContent = `${movementLabel}${delta === null ? '' : ` · HP ${delta > 0 ? '+' : ''}${delta.toLocaleString('tr-TR')}`}`;
      li.append(detail, badge);
      list.append(li);
    }
    results.replaceChildren(overview, note, heading, list);
  }

  async function loadArchive() {
    if (loaded || loading) return;
    loading = true;
    setStatus('İki yıllık TJK arşivi yükleniyor…');
    try {
      const response = await fetch('/api/race-history?limit=5000&offset=0', { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload)) throw new Error(payload.error || 'Yarış arşivi alınamadı.');
      archive = payload;
      if (payload.length === 5000) {
        const next = await fetch('/api/race-history?limit=5000&offset=5000', { headers: { Accept: 'application/json' } });
        const page = await next.json();
        if (!next.ok || !Array.isArray(page)) throw new Error(page.error || 'Arşivin devamı alınamadı.');
        archive.push(...page);
      }
      loaded = true;
      const cities = [...new Set(archive.map((row) => row.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
      for (const city of cities) citySelect.add(new Option(city, city));
      renderHorseOptions();
      setStatus(archive.length ? `${archive.length.toLocaleString('tr-TR')} TJK koşusu tarandı. At adıyla arayın; sonuçlar arşiv kapsamıyla sınırlıdır.` : 'Arşiv boş. Önce Arşiv & Hesap bölümünden TJK geçmişini içe aktarın.');
    } catch (error) {
      setStatus(error.message || 'Arşiv yüklenemedi.', true);
    } finally {
      loading = false;
    }
  }

  queryInput.addEventListener('input', renderHorseOptions);
  citySelect.addEventListener('change', renderHorseOptions);
  horseSelect.addEventListener('change', renderHorseHistory);
  document.querySelector('[data-panel="sinif"]')?.addEventListener('click', loadArchive);
})();
