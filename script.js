(() => {
  const startInput = document.getElementById('historyFrom');
  const endInput = document.getElementById('historyTo');
  const importButton = document.getElementById('importHistoryButton');
  const stopButton = document.getElementById('stopHistoryButton');
  const backtestButton = document.getElementById('backtestButton');
  const status = document.getElementById('historyStatus');
  const progress = document.getElementById('historyProgress');
  const summary = document.getElementById('historySummary');
  const backtestSummary = document.getElementById('backtestSummary');
  if (!startInput || !endInput || !importButton) return;

  const today = new Date();
  const twoYearsAgo = new Date(today);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const toIsoDate = (date) => {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
  };
  const earliestDate = toIsoDate(twoYearsAgo);
  startInput.min = earliestDate;
  endInput.min = earliestDate;
  startInput.value = earliestDate;
  endInput.value = toIsoDate(today);
  startInput.max = endInput.value;
  endInput.max = endInput.value;

  let stopRequested = false;
  let importing = false;

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function renderMetric(label, value) {
    const item = document.createElement('div');
    item.className = 'stat';
    const title = document.createElement('span');
    title.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = value;
    item.append(title, strong);
    return item;
  }

  async function loadSummary() {
    try {
      const response = await fetch('/api/history/', { headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Arşiv bilgisi alınamadı.');
      summary.replaceChildren(
        renderMetric('Neon kayıtlı koşu', Number(data.raceCount || 0).toLocaleString('tr-TR')),
        renderMetric('İlk kayıt', data.firstDate || '—'),
        renderMetric('Son kayıt', data.lastDate || '—')
      );
      setStatus(Number(data.raceCount || 0) ? 'TJK arşivi Neon veritabanında hazır.' : 'Neon arşivi boş; TJK’den tarih aralığı seçerek içe aktarın.');
      return true;
    } catch (error) {
      setStatus(error.message || 'Neon arşivi yüklenemedi.', true);
      return false;
    }
  }

  function eachDate(from, to) {
    const dates = [];
    const cursor = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cursor <= end) {
      dates.push(toIsoDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  importButton.addEventListener('click', async () => {
    if (importing) return;
    const dates = eachDate(startInput.value, endInput.value);
    if (!dates.length || dates.length > 732) {
      setStatus('Başlangıç ve bitiş tarihlerini kontrol edin; aralık iki yılı aşamaz.', true);
      return;
    }

    importing = true;
    stopRequested = false;
    importButton.disabled = true;
    stopButton.disabled = false;
    progress.max = dates.length;
    progress.value = 0;
    let savedRaces = 0;
    let alreadyCompleteDays = 0;
    let completed = 0;
    let failures = 0;

    for (const date of dates) {
      if (stopRequested) break;
      try {
        const response = await fetch('/api/history/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ date })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Gün içe aktarılamadı.');
        savedRaces += Number(data.savedRaces || 0);
        if (data.alreadyComplete) alreadyCompleteDays += 1;
        if (data.warnings?.length) failures += 1;
      } catch {
        failures += 1;
      }
      completed += 1;
      progress.value = completed;
      setStatus(`${completed}/${dates.length} gün işlendi · ${savedRaces} yeni/güncellenmiş koşu · ${alreadyCompleteDays} gün zaten eksiksiz · ${failures} gün uyarılı/başarısız.`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    importing = false;
    importButton.disabled = false;
    stopButton.disabled = true;
    const stopped = stopRequested && completed < dates.length;
    const finalStatus = `${stopped ? 'İçe aktarma durduruldu' : 'İçe aktarma tamamlandı'}: ${completed}/${dates.length} gün, ${savedRaces} yeni/güncellenmiş koşu, ${alreadyCompleteDays} gün zaten eksiksiz, ${failures} uyarılı/başarısız gün.`;
    const summaryLoaded = await loadSummary();
    setStatus(`${finalStatus}${summaryLoaded ? '' : ' Neon arşiv özeti yenilenemedi.'}`, !summaryLoaded);
  });

  stopButton.addEventListener('click', () => {
    stopRequested = true;
    setStatus('Devam eden gün tamamlanınca içe aktarma duracak.');
  });

  backtestButton.addEventListener('click', async () => {
    backtestButton.disabled = true;
    backtestSummary.textContent = 'Geriye dönük test hesaplanıyor…';
    try {
      const query = new URLSearchParams({ from: startInput.value, to: endInput.value });
      const response = await fetch(`/api/backtest?${query}`, { headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Test çalıştırılamadı.');
      const metrics = document.createElement('div');
      metrics.className = 'stats';
      metrics.append(
        renderMetric('Değerlendirilen koşu', Number(data.evaluatedRaces || 0).toLocaleString('tr-TR')),
        renderMetric('İlk 3 içinden en az 1 isabet', data.topThreeHitRaceRate == null ? '—' : `${data.topThreeHitRaceRate}%`),
        renderMetric('İlk 3 ortalama isabet', data.averageTopThreeHits == null ? '—' : String(data.averageTopThreeHits)),
        renderMetric('En yüksek puanlı at birinci', data.winnerHitRate == null ? '—' : `${data.winnerHitRate}%`)
      );
      const note = document.createElement('p');
      note.className = 'sub';
      note.textContent = `Tek günlük veya küçük örnek sonuçları genellemez. Kaydedilmiş ${Number(data.storedRaces || 0).toLocaleString('tr-TR')} koşudan ${Number(data.omittedRaces || 0).toLocaleString('tr-TR')} tanesi gerekli program/sonuç eşleşmesi olmadığı için test dışı kaldı. ${data.method}`;
      const breakdown = document.createElement('section');
      const breakdownTitle = document.createElement('h3');
      breakdownTitle.textContent = 'Yarış türüne göre';
      const breakdownList = document.createElement('ul');
      for (const group of data.byRaceType || []) {
        const item = document.createElement('li');
        item.textContent = `${group.raceType} · ${group.races} koşu · İlk 3 isabeti ${group.topThreeHitRaceRate}% · Kazanan ${group.winnerHitRate}%`;
        breakdownList.append(item);
      }
      if (!breakdownList.childElementCount) {
        const item = document.createElement('li');
        item.textContent = 'Henüz yarış türü bazında değerlendirilecek yeterli eşleşme yok.';
        breakdownList.append(item);
      }
      breakdown.append(breakdownTitle, breakdownList);
      backtestSummary.replaceChildren(metrics, note, breakdown);
    } catch (error) {
      backtestSummary.textContent = error.message || 'Geriye dönük test çalıştırılamadı.';
    } finally {
      backtestButton.disabled = false;
    }
  });

  loadSummary();
})();
