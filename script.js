(() => {
  const startInput = document.getElementById('historyFrom');
  const endInput = document.getElementById('historyTo');
  const importButton = document.getElementById('importHistoryButton');
  const stopButton = document.getElementById('stopHistoryButton');
  const backtestButton = document.getElementById('backtestButton');
  const backtestStartInput = document.getElementById('backtestFrom');
  const backtestEndInput = document.getElementById('backtestTo');
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
  backtestStartInput.min = earliestDate;
  backtestEndInput.min = earliestDate;
  backtestStartInput.value = earliestDate;
  backtestEndInput.value = toIsoDate(today);
  backtestStartInput.max = backtestEndInput.value;
  backtestEndInput.max = backtestEndInput.value;

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
    let firebaseApi = null;
    let signedIn = false;
    try {
      firebaseApi = await window.RaceRobotFirebaseReady;
      signedIn = Boolean(firebaseApi?.ok && await firebaseApi.getIdToken());
    } catch { /* The user can still use the local analysis tools while signed out. */ }
    if (!signedIn) {
      importing = false;
      setStatus('TJK arşivini içe aktarmak için önce Firebase hesabınızla giriş yapın.', true);
      return;
    }
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
      let accessToken = null;
      try { accessToken = await firebaseApi.getIdToken(); } catch { /* Expired sessions are handled below. */ }
      if (!accessToken) {
        stopRequested = true;
        setStatus('Oturum sona erdi. Yeniden giriş yapıp içe aktarmayı tekrar başlatın.', true);
        break;
      }
      try {
        const response = await fetch('/api/history/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
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
      const query = new URLSearchParams({ from: backtestStartInput.value, to: backtestEndInput.value });
      const response = await fetch(`/api/backtest?${query}`, { headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Test çalıştırılamadı.');
      const metrics = document.createElement('div');
      metrics.className = 'stats';
      metrics.append(
        renderMetric('Değerlendirilen koşu', Number(data.evaluatedRaces || 0).toLocaleString('tr-TR')),
        renderMetric('İlk 3 içinden en az 1 isabet', data.topThreeHitRaceRate == null ? '—' : `${data.topThreeHitRaceRate}%`),
        renderMetric('İlk 3 ortalama isabet', data.averageTopThreeHits == null ? '—' : String(data.averageTopThreeHits)),
        renderMetric('Model lideri birinci', data.winnerHitRate == null ? '—' : `${data.winnerHitRate}%`),
        renderMetric('Rastgele seçim referansı', data.randomPickHitRate == null ? '—' : `${data.randomPickHitRate}%`),
        renderMetric('Kazanan ilk 3 sıramızda', data.winnerTopThreeRankRate == null ? '—' : `${data.winnerTopThreeRankRate}%`),
        renderMetric('Kazananın ortalama sırası', data.averageWinnerRank == null ? '—' : String(data.averageWinnerRank)),
        renderMetric('Piyasa favorisi birinci', data.marketFavoriteHitRate == null ? '—' : `${data.marketFavoriteHitRate}%`),
        renderMetric('Sürpriz adayları kazananı yakaladı', data.surpriseCandidateHitRate == null ? '—' : `${data.surpriseCandidateHitRate}%`)
      );
      const validation = data.validation || {};
      const validationTitle = document.createElement('h3');
      validationTitle.textContent = 'Son %20 tarih diliminde tek seçim eşiği denemesi';
      const validationNote = document.createElement('p');
      validationNote.className = 'sub';
      validationNote.textContent = validation.from
        ? `Son tarih dilimi (${validation.from} – ${validation.to || '—'}) ağırlık güncellemesinde kullanılmadı; yalnızca eşik karşılaştırmasıdır. ${validation.races || 0} koşu. Model lideri: ${validation.baselineTop1HitRate ?? '—'}%, piyasa favorisi: ${validation.marketFavoriteHitRate ?? '—'}%. Model piyasa kıyasını geçmediyse yüksek puan tek başına güvenilir seçim sayılmamalı. 30’dan az tek seçim adayı yetersiz örnektir. Test varsayılan ortak modeli kullanır; kullanıcıya özel öğrenilmiş ağırlıkları veya kupon getirisini temsil etmez.`
        : 'En az 5 ayrı yarış tarihi olmadığından zamana göre ayrılmış doğrulama dilimi oluşturulmadı; eşik sonucu gösterilemiyor.';
      const thresholdList = document.createElement('ul');
      for (const item of validation.thresholds || []) {
        const row = document.createElement('li');
        const validationLabel = item.validated ? ' · doğrulandı (genel liderden iyi)' : item.enoughCandidates ? ' · genel lider isabetini geçmedi' : ' · örnek yetersiz (<30)';
        row.textContent = `${item.scoreGap} puan farkı + %${item.independentCoverageMinimum} bağımsız kapsam: ${item.candidates} tek seçim · ${item.wins} kazanan · isabet ${item.winRate ?? '—'}%${validationLabel}`;
        thresholdList.append(row);
      }
      if (!thresholdList.childElementCount) {
        const row = document.createElement('li');
        row.textContent = 'Bu aralık için eşik denemesi yapılabilecek yeterli tarih verisi yok.';
        thresholdList.append(row);
      }
      const validationBlock = document.createElement('section');
      validationBlock.append(validationTitle, validationNote, thresholdList);
      const note = document.createElement('p');
      note.className = 'sub';
      note.textContent = `Tek günlük veya küçük örnek sonuçları genellemez. Kaydedilmiş ${Number(data.storedRaces || 0).toLocaleString('tr-TR')} koşudan ${Number(data.omittedRaces || 0).toLocaleString('tr-TR')} tanesi gerekli program/sonuç eşleşmesi olmadığı için test dışı kaldı. ${data.method}`;
      const rankBreakdown = document.createElement('section');
      const rankTitle = document.createElement('h3');
      rankTitle.textContent = 'Kazananın model sıralamasındaki yeri';
      const rankNote = document.createElement('p');
      rankNote.className = 'sub';
      rankNote.textContent = 'Bu ölçüm, en yüksek puanlı seçimimizin dışında kazananların ne sıklıkta kaldığını gösterir. Sıralama puanı kazanma olasılığı değildir.';
      const rankList = document.createElement('ul');
      const rankLabels = [['1', 'Model lideri'], ['2–3', '2.–3. sıra'], ['4–6', '4.–6. sıra'], ['7+', '7. sıra ve altı']];
      for (const [key, label] of rankLabels) {
        const row = document.createElement('li');
        const count = Number(data.winnerRankCounts?.[key] || 0);
        const rate = data.evaluatedRaces ? (count / data.evaluatedRaces * 100).toFixed(1) : '0.0';
        row.textContent = `${label}: ${count} koşu (%${rate})`;
        rankList.append(row);
      }
      rankBreakdown.append(rankTitle, rankNote, rankList);
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
      backtestSummary.replaceChildren(metrics, validationBlock, note, rankBreakdown, breakdown);
    } catch (error) {
      backtestSummary.textContent = error.message || 'Geriye dönük test çalıştırılamadı.';
    } finally {
      backtestButton.disabled = false;
    }
  });

  loadSummary();
})();
const STORAGE_KEY = "race-analysis-v1";
const BASE_WEIGHTS = window.RaceScoring.BASE_WEIGHTS;
const MODEL_VERSION = "single-weighted-v1";
const MODEL_MIN_RACES = 30;
const TRAINING_WINDOW_RACES = 2000;
const SINGLE_GAP_THRESHOLD = 12.5;
const MIN_SINGLE_COVERAGE = 50;
let scoreCache = new WeakMap();
let classHistoryArchive = new Map();
const DEFAULT_STATE = { version: 3, profiles: {}, predictions: [], outcomes: [], coupons: [], modelWeights: { ...BASE_WEIGHTS }, lastGoodModelWeights: { ...BASE_WEIGHTS }, modelWeightVersions: [], contextWeights: {} };
const DEFAULT_PROFILES = {
  DIESIS: [2, 4, 10, 4, 0], SINGSPIEL: [0, 2, 8, 8, 2], VICTORYGALLOP: [4, 6, 12, 4, 0],
  NATIVEKHAN: [2, 4, 8, 2, 0], LUXOR: [6, 6, 4, 0, 0], KANEKO: [4, 8, 6, 0, 0],
  MENDIP: [4, 6, 8, 2, 0], TOROK: [6, 6, 4, 0, 0], LIONHEART: [8, 4, 4, 0, 0],
  SRIPAD: [4, 6, 6, 2, 0], KURTINIADIS: [4, 6, 8, 2, 0], TURBO: [6, 6, 4, 0, 0],
  KAIZBERT: [8, 6, 2, 0, 0], OZGUNHAN: [2, 4, 8, 4, 0], FLIGHTLINE: [4, 6, 8, 2, 0],
  GUNRUNNER: [4, 6, 8, 2, 0], TAPIT: [2, 4, 10, 4, 0], MUNNINGS: [8, 4, 2, 0, 0],
  PRACTICALJOKE: [6, 6, 4, 0, 0], INVINCIBLESPIRIT: [8, 4, 2, 0, 0], CAIROPRINCE: [4, 6, 8, 2, 0],
  GOODMAGIC: [4, 6, 8, 2, 0], SMILINGTIGER: [8, 4, 2, 0, 0], MALIBUMOON: [4, 6, 8, 2, 0], DISTORTEDHUMOR: [6, 6, 4, 0, 0]
};

function normalizeState(saved) {
  const modelWeights = { ...BASE_WEIGHTS, ...(saved?.modelWeights || {}) };
  const hasWeightHistory = Array.isArray(saved?.modelWeightVersions) && saved.modelWeightVersions.length > 0;
  const modelWeightVersions = hasWeightHistory ? saved.modelWeightVersions.slice(-20) : Object.keys(BASE_WEIGHTS).some((key) => Math.abs(Number(modelWeights[key]) - Number(BASE_WEIGHTS[key])) > 1e-8) ? [{ version: 1, weights: modelWeights, createdAt: saved?.trainingReport?.validatedAt || null, legacy: true }] : [];
  return {
    ...DEFAULT_STATE,
    ...(saved && typeof saved === "object" ? saved : {}),
    version: 3,
    profiles: { ...DEFAULT_PROFILES, ...(saved?.profiles || {}) },
    predictions: Array.isArray(saved?.predictions) ? saved.predictions : [],
    outcomes: Array.isArray(saved?.outcomes) ? saved.outcomes : [],
    coupons: Array.isArray(saved?.coupons) ? saved.coupons : [],
    modelWeights,
    lastGoodModelWeights: { ...BASE_WEIGHTS, ...(saved?.lastGoodModelWeights || saved?.modelWeights || {}) },
    modelWeightVersions,
    contextWeights: saved?.contextWeights && typeof saved.contextWeights === "object" ? saved.contextWeights : {}
  };
}
function loadLegacyState() {
  try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
  catch { return normalizeState(null); }
}
function openStateDatabase() {
  return new Promise((resolve) => {
    if (!window.indexedDB) { resolve(null); return; }
    const request = indexedDB.open("race-analysis-memory", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("app", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}
async function restoreState() {
  stateDb = await openStateDatabase();
  if (!stateDb) return loadLegacyState();
  const stored = await new Promise((resolve) => {
    const request = stateDb.transaction("app", "readonly").objectStore("app").get("current");
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => resolve(null);
  });
  if (stored) return normalizeState(stored);
  const legacy = loadLegacyState();
  try {
    const transaction = stateDb.transaction("app", "readwrite");
    transaction.objectStore("app").put({ id: "current", value: legacy });
  } catch { /* The legacy copy remains available as a fallback. */ }
  return legacy;
}
let state = normalizeState(null);
let stateDb = null;
let lastAnalysis = [];
let lastCoupons = {};
let pendingResultImport = null;
let deferredInstallPrompt = null;
let singleEvidenceCache = null;
let firebaseSdk = null;
let firebaseAccount = null;
let firebaseSyncReady = false;
let firebaseSaveTimer = null;
let firebaseSyncChain = Promise.resolve();
let driveConnected = false;
let driveBusy = false;
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function persistStateLocally() {
  if (stateDb) {
    try {
      const transaction = stateDb.transaction("app", "readwrite");
      transaction.objectStore("app").put({ id: "current", value: JSON.parse(JSON.stringify(state)) });
      transaction.onabort = transaction.onerror = () => showMessage($("ogrenmeLogAlani"), "Tarayıcı hafızasına yazılamadı. Yedeği indirip saklayın.", "error");
    } catch { showMessage($("ogrenmeLogAlani"), "Tarayıcı hafızasına erişilemiyor. Yedeği indirip saklayın.", "error"); }
  } else {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { showMessage($("ogrenmeLogAlani"), "Tarayıcı depolaması dolu veya kullanılamıyor. Yedeği indirip saklayın.", "error"); }
  }
}
function setFirebaseStatus(message, isError = false) {
  const status = $("firebaseMemoryStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}
function setDriveStatus(message, isError = false) {
  const status = $("driveBackupStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}
function updateDriveButtons() {
  const signedIn = Boolean(firebaseAccount && firebaseSyncReady);
  $("driveConnectButton").disabled = !signedIn || driveBusy;
  $("driveBackupButton").disabled = !signedIn || !driveConnected || driveBusy;
  $("driveRestoreButton").disabled = !signedIn || !driveConnected || driveBusy;
}
async function requestDriveAction(action, backup) {
  const idToken = await firebaseSdk?.getIdToken();
  if (!idToken) throw new Error("Google Drive yedeği için Firebase hesabınızla giriş yapın.");
  const response = await fetch("/api/google-drive-backup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ action, ...(backup ? { backup } : {}) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Google Drive isteği başarısız oldu.");
  return result;
}
async function refreshDriveStatus() {
  if (!firebaseAccount || !firebaseSyncReady) return;
  try {
    const result = await requestDriveAction("status");
    driveConnected = Boolean(result.connected);
    if (driveConnected) setDriveStatus("Google Drive bağlı. Yedeği istediğiniz zaman oluşturabilir veya geri yükleyebilirsiniz.");
    else if (new URLSearchParams(location.search).get("drive") === "connected") setDriveStatus("Google Drive izni alındı. Bağlantıyı denetleyin veya yeniden bağlayın.", true);
    else setDriveStatus("Kişisel yedekleme için Google Drive’ı bağlayın.");
  } catch {
    driveConnected = false;
    setDriveStatus("Google Drive bağlantı durumu denetlenemedi. Yeniden deneyin.", true);
  }
  updateDriveButtons();
}
async function connectGoogleDrive() {
  if (!firebaseAccount || !firebaseSyncReady) return;
  const framed = window.self !== window.top;
  const authorizationWindow = framed ? window.open("about:blank", "_blank") : null;
  if (authorizationWindow) authorizationWindow.opener = null;
  driveBusy = true;
  updateDriveButtons();
  setDriveStatus("Google Drive bağlantısı hazırlanıyor…");
  try {
    const result = await requestDriveAction("connect");
    if (result.authorizationUrl) {
      setDriveStatus("Google izin sayfası açılıyor. İzin verdikten sonra bu uygulamaya geri dönün.");
      if (framed) {
        if (authorizationWindow) authorizationWindow.location.replace(result.authorizationUrl);
        else setDriveStatus("Yeni sekme açılamadı. Tarayıcıda açılır pencerelere izin verip yeniden deneyin.", true);
      } else {
        location.href = result.authorizationUrl;
        return;
      }
    } else {
      authorizationWindow?.close();
      driveConnected = true;
      setDriveStatus("Google Drive başarıyla bağlandı.");
    }
  } catch (error) {
    authorizationWindow?.close();
    setDriveStatus(error.message || "Google Drive bağlanamadı.", true);
  } finally {
    driveBusy = false;
    updateDriveButtons();
  }
}
function createDriveBackup() {
  const backupState = JSON.parse(JSON.stringify(state));
  delete backupState.firebaseOwnerUid;
  backupState.outcomes = (backupState.outcomes || []).filter((item) => !String(item.sourceKey || "").startsWith("tjk:"));
  return { app: "yar-robotu", version: 1, createdAt: new Date().toISOString(), state: backupState };
}
async function backupToGoogleDrive() {
  if (!firebaseAccount || !firebaseSyncReady || !driveConnected) return;
  driveBusy = true;
  updateDriveButtons();
  setDriveStatus("Hafıza eşitleniyor ve Drive yedeği hazırlanıyor…");
  try {
    await firebaseSyncChain;
    const snapshot = JSON.parse(JSON.stringify(state));
    await firebaseSdk.saveMemory(firebaseAccount, snapshot);
    const result = await requestDriveAction("backup", createDriveBackup());
    if (result.authorizationUrl) throw new Error("Drive bağlantısı yenilenmeli. Google Drive’ı yeniden bağlayın.");
    setDriveStatus(`Yedek Google Drive’a kaydedildi: ${new Date(result.modifiedTime).toLocaleString("tr-TR")}.`);
  } catch (error) {
    setDriveStatus(error.message || "Google Drive yedeği oluşturulamadı.", true);
  } finally {
    driveBusy = false;
    updateDriveButtons();
  }
}
async function restoreFromGoogleDrive() {
  if (!firebaseAccount || !firebaseSyncReady || !driveConnected) return;
  if (!window.confirm("Google Drive’daki yedek mevcut hafızanızla birleştirilecek. Devam edilsin mi?")) return;
  driveBusy = true;
  updateDriveButtons();
  setDriveStatus("Google Drive yedeği okunuyor…");
  try {
    const result = await requestDriveAction("restore");
    if (result.authorizationUrl) throw new Error("Drive bağlantısı yenilenmeli. Google Drive’ı yeniden bağlayın.");
    state = mergeFirebaseMemory(state, result.backup.state);
    state.firebaseOwnerUid = firebaseAccount.uid;
    state.localUpdatedAt = new Date().toISOString();
    persistStateLocally();
    updateMemory();
    await firebaseSdk.saveMemory(firebaseAccount, JSON.parse(JSON.stringify(state)));
    setDriveStatus(`Yedek hafızayla birleştirildi ve Firebase’e eşitlendi${result.modifiedTime ? ` (${new Date(result.modifiedTime).toLocaleString("tr-TR")})` : ""}.`);
  } catch (error) {
    setDriveStatus(error.message || "Google Drive yedeği geri yüklenemedi.", true);
  } finally {
    driveBusy = false;
    updateDriveButtons();
  }
}
function mergeMemoryRecords(remoteRecords, localRecords, keyOf) {
  const merged = new Map();
  for (const item of remoteRecords || []) merged.set(keyOf(item), item);
  for (const item of localRecords || []) merged.set(keyOf(item), item);
  return [...merged.values()];
}
function predictionKey(item) {
  return `${item.date || ""}:${normalize(item.city || "")}:${item.no ?? ""}`;
}
function mergePredictionHistory(existing, incoming) {
  return mergeMemoryRecords(existing, incoming, predictionKey).sort((a, b) =>
    String(a.date || "").localeCompare(String(b.date || ""))
    || normalize(a.city || "").localeCompare(normalize(b.city || ""))
    || Number(a.no || 0) - Number(b.no || 0)
  );
}
function mergeFirebaseMemory(localState, remoteState) {
  const localTime = Date.parse(localState.localUpdatedAt || "") || 0;
  const remoteTime = Date.parse(remoteState.localUpdatedAt || "") || 0;
  const latest = remoteTime > localTime ? remoteState : localState;
  const profiles = remoteTime > localTime
    ? { ...(localState.profiles || {}), ...(remoteState.profiles || {}) }
    : { ...(remoteState.profiles || {}), ...(localState.profiles || {}) };
  return normalizeState({
    ...latest,
    profiles,
    predictions: mergePredictionHistory(remoteState.predictions, localState.predictions),
    outcomes: mergeMemoryRecords(remoteState.outcomes, localState.outcomes, (item) => item.sourceKey || `${String(item.at || "").slice(0, 10)}:${item.city || ""}:${item.raceNo}:${item.winner}`),
    coupons: mergeMemoryRecords(remoteState.coupons, localState.coupons, (item) => item.id || JSON.stringify(item))
  });
}
function queueFirebaseMemorySync() {
  if (!firebaseAccount || !firebaseSyncReady || !firebaseSdk) return;
  clearTimeout(firebaseSaveTimer);
  const account = firebaseAccount;
  const snapshot = JSON.parse(JSON.stringify(state));
  firebaseSaveTimer = window.setTimeout(() => {
    firebaseSyncChain = firebaseSyncChain.then(async () => {
      if (!firebaseSyncReady || firebaseAccount?.uid !== account.uid || snapshot.localUpdatedAt !== state.localUpdatedAt) return;
      await firebaseSdk.saveMemory(account, snapshot);
      setFirebaseStatus(`Hafıza Firebase hesabınızla eşitlendi: ${account.email || account.uid}`);
    }).catch(() => {
      setFirebaseStatus("Firebase eşitlemesi başarısız. Yerel kayıtlar korunuyor; Firestore kurallarını ve bağlantıyı kontrol edin.", true);
    });
  }, 900);
}
async function initializeFirebaseMemory() {
  const api = await window.RaceRobotFirebaseReady;
  if (!api?.ok) {
    setFirebaseStatus("Firebase yapılandırmasına şu an ulaşılamıyor. Yerel hafıza çalışmaya devam ediyor.", true);
    return;
  }
  firebaseSdk = api;
  $("firebaseAuthForm")?.querySelectorAll("input, button").forEach((element) => { element.disabled = false; });
  $("firebaseAuthForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api.signIn($("firebaseEmail").value.trim(), $("firebasePassword").value);
      setFirebaseStatus("Giriş başarılı; Firebase hafızası yükleniyor…");
    } catch {
      setFirebaseStatus("Giriş başarısız. E-posta ve parolayı, ayrıca Firebase Authentication e-posta/parola sağlayıcısını kontrol edin.", true);
    }
  });
  $("firebaseCreateAccountButton")?.addEventListener("click", async () => {
    if (!$("firebaseAuthForm").reportValidity()) return;
    try {
      await api.createAccount($("firebaseEmail").value.trim(), $("firebasePassword").value);
      setFirebaseStatus("Hesap oluşturuldu; hafıza hesabınıza aktarılıyor…");
    } catch {
      setFirebaseStatus("Hesap oluşturulamadı. Parolanın en az 6 karakter olduğunu ve e-posta/parola sağlayıcısının açık olduğunu kontrol edin.", true);
    }
  });
  $("firebaseSignOutButton")?.addEventListener("click", async () => {
    if (!firebaseAccount || !firebaseSyncReady) return;
    try {
      await firebaseSdk.saveMemory(firebaseAccount, JSON.parse(JSON.stringify(state)));
      await api.signOut();
      firebaseAccount = null;
      firebaseSyncReady = false;
      state = normalizeState(null);
      lastAnalysis = [];
      persistStateLocally();
      window.location.reload();
    } catch {
      setFirebaseStatus("Son eşitleme tamamlanmadı; veri kaybını önlemek için oturum açık bırakıldı.", true);
    }
  });
  api.onAuthStateChanged(async (user) => {
    firebaseAccount = user || null;
    firebaseSyncReady = false;
    driveConnected = false;
    updateDriveButtons();
    $("firebaseSignOutButton").hidden = !user;
    $("firebaseAuthForm").hidden = Boolean(user);
    $("firebaseCreateAccountButton").hidden = Boolean(user);
    if (!user) {
      setFirebaseStatus("Oturum açmadan bu tarayıcıda kullanabilirsiniz; giriş yaptığınızda kişisel hafıza hesabınızla eşitlenir.");
      return;
    }
    setFirebaseStatus("Firebase hafızası okunuyor…");
    try {
      const remoteMemory = await api.loadMemory(user);
      if (firebaseAccount?.uid !== user.uid) return;
      const localMemory = state.firebaseOwnerUid && state.firebaseOwnerUid !== user.uid ? normalizeState(null) : state;
      singleEvidenceCache = null;
      state = remoteMemory ? mergeFirebaseMemory(localMemory, remoteMemory) : normalizeState(localMemory);
      state.firebaseOwnerUid = user.uid;
      state.localUpdatedAt = new Date().toISOString();
      if (state.predictions?.length) lastAnalysis = state.predictions;
      persistStateLocally();
      updateMemory();
      firebaseSyncReady = true;
      await api.saveMemory(user, JSON.parse(JSON.stringify(state)));
      setFirebaseStatus(`Hafıza Firebase hesabınızla eşitlendi: ${user.email || user.uid}`);
      await refreshDriveStatus();
    } catch {
      firebaseSyncReady = false;
      setFirebaseStatus("Firebase verisi okunamadı. Yerel kayıtlar korundu; Firestore kurallarına users/{uid} için yalnızca aynı kullanıcı erişimini ekleyin.", true);
    }
  });
}
function saveState() {
  singleEvidenceCache = null;
  state.localUpdatedAt = new Date().toISOString();
  persistStateLocally();
  updateMemory();
  queueFirebaseMemorySync();
}
function showMessage(target, text, type = "") {
  target.setAttribute("role", type === "error" ? "alert" : "status");
  target.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  target.innerHTML = `<div class="alert ${type}">${escapeHtml(text)}</div>`;
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function setTab(name) {
  document.querySelectorAll(".tab").forEach((button) => { const active = (button.dataset.tab || button.dataset.panel) === name; button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1; });
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${name}`));
}
function normalize(text) { return text.toLocaleUpperCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "I"); }
function parseNumber(value) { const result = Number(String(value || "").replace(",", ".")); return Number.isFinite(result) ? result : null; }
function parseRaces(text) {
  const parsedRaces = window.RaceParser.parseRaces(text);
  const races = parsedRaces.map((race) => {
    const raceType = normalize(race.raceType || "");
    const type = raceType.includes("HANDIKAP") ? "HANDİKAP" : raceType.includes("MAIDEN") || raceType.includes("SATIS") ? "MAIDEN / SATIŞ" : "DİĞER";
    const horses = race.horses.map((horse) => ({
      ...horse,
      number: horse.horseNumber ?? horse.no,
      hp: horse.handicapPoints,
      last6: horse.form || "",
      place: Number(horse.rank) > 0 ? Number(horse.rank) : null
    }));
    const placed = horses.filter((horse) => Number.isInteger(horse.place) && horse.place > 0);
    return {
      ...race,
      type,
      horses,
      finished: placed.length >= 2 && placed.some((horse) => horse.place === 1)
    };
  });
  const warnings = races.length ? [] : ["Koşu ve at satırı bulunamadı. TJK metnini sekme ayrımları korunacak şekilde yeniden kopyalayın."];
  return { races, warnings };
}
function profileScore(name, distance) {
  const profile = state.profiles[normalize(name).replace(/[^A-Z0-9]/g, "")];
  if (!Array.isArray(profile)) return null;
  const [speed, intermediate, classic, stamina, staminaPlus] = profile.map(Number);
  const total = speed + intermediate + classic + stamina + staminaPlus;
  if (!total) return null;
  const speedFit = (speed + intermediate) / total;
  const staminaFit = (stamina + staminaPlus) / total;
  const middleFit = (classic + intermediate) / total;
  return 45 + 55 * (distance <= 1300 ? speedFit : distance >= 1800 ? staminaFit : middleFit);
}
function scoreRace(race) {
  const cached = scoreCache.get(race);
  if (cached) return cached;
  const raceDate = race.date || $("couponDateInput")?.value || new Date().toISOString().slice(0, 10);
  const raceClass = race.raceType || race.raceCategory || race.title || race.type;
  const scoringRace = {
    ...race,
    horses: race.horses.map((horse) => ({
      ...horse,
      classHistoryScore: window.RaceClassHistory.scoreForHorse(classHistoryArchive, horse.name, raceClass, raceDate)
    }))
  };
  const ranked = window.RaceScoring.analyzeRace(scoringRace, {
    modelWeights: state.modelWeights,
    contextWeights: state.contextWeights,
    profileScore
  });
  scoreCache.set(race, ranked);
  return ranked;
}
function singleSelectionEvidence() {
  if (singleEvidenceCache) return singleEvidenceCache;
  const outcomes = state.outcomes.filter((item) => item.modelVersion === MODEL_VERSION && !String(item.sourceKey || "").startsWith("tjk:") && Array.isArray(item.horses) && item.horses.length > 1 && String(item.at || "").slice(0, 10));
  const dates = [...new Set(outcomes.map((item) => String(item.at).slice(0, 10)))].sort();
  if (dates.length < 5) {
    singleEvidenceCache = { validated: false, candidates: 0, wins: 0, hitRate: null, baselineHitRate: null, validationStartDate: null };
    return singleEvidenceCache;
  }
  const validationStartDate = dates[Math.floor(dates.length * 0.8)];
  const validation = outcomes.filter((item) => String(item.at).slice(0, 10) >= validationStartDate);
  const candidates = validation.filter((item) => item.singleCandidate);
  const wins = candidates.filter((item) => item.singleHit).length;
  const baselineWins = validation.filter((item) => item.top1Hit).length;
  const hitRate = candidates.length ? wins / candidates.length : null;
  const baselineHitRate = validation.length ? baselineWins / validation.length : null;
  singleEvidenceCache = {
    validated: candidates.length >= 30 && hitRate > baselineHitRate,
    candidates: candidates.length,
    wins,
    hitRate,
    baselineHitRate,
    validationStartDate
  };
  return singleEvidenceCache;
}
function isValidatedSingle(ranked) {
  if (ranked.length === 1) return true;
  if (ranked.length < 2) return false;
  const gap = ranked[0].score - ranked[1].score;
  return gap >= SINGLE_GAP_THRESHOLD && ranked[0].independentCoverage >= MIN_SINGLE_COVERAGE && singleSelectionEvidence().validated;
}
async function analyzeRaces(races) {
  const results = [];
  for (const race of races) {
    results.push(scoreRace(race));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return results;
}
function renderAnalysis(races, targetId = "kosuSonucAlani") {
  const target = $(targetId);
  target.innerHTML = races.map((race) => {
    const heading = `<h3>${race.no}. Koşu${race.time ? ` · ${escapeHtml(race.time)}` : ""} · ${escapeHtml(race.distance)} m ${escapeHtml(race.surface)} <span class="muted">· ${escapeHtml(race.type)}</span></h3>`;
    const signalLabels = { banko: "Banko", favorite: "Favorim", rival: "Rakip", surprise: "Sürpriz" };
    const signalBadges = Object.entries(race.externalSignals || {}).map(([key, numbers]) => `<span class="signal-badge">${signalLabels[key]} #${numbers.join(", #")}</span>`).join(" ");
    const signalNote = signalBadges ? `<p class="external-signals"><strong>Harici yorum:</strong> ${signalBadges}</p>` : "";
    if (race.finished) return `<article class="race">${heading}${signalNote}<p class="alert">Koşuldu · sonuç verisi bulundu. Bu ayak için tahmin gösterilmiyor.</p></article>`;
    const ranked = scoreRace(race);
    const leaderGap = ranked.length > 1 ? Number((ranked[0].score - ranked[1].score).toFixed(1)) : 0;
    const evidence = singleSelectionEvidence();
    const singleEligible = isValidatedSingle(ranked);
    const evidenceDetail = evidence.candidates < 30
      ? `doğrulamada ${evidence.candidates}/30 aday`
      : `aday isabeti %${(evidence.hitRate * 100).toFixed(1)} · genel lider isabeti %${(evidence.baselineHitRate * 100).toFixed(1)}`;
    const singleNote = ranked.length > 1
      ? `Lider farkı ${leaderGap} puan · bağımsız veri kapsamı %${ranked[0].independentCoverage} · ${singleEligible ? "tek seçim eşiği geçmiş doğrulamada desteklendi" : `tek seçim önerilmiyor: ${SINGLE_GAP_THRESHOLD} puan fark, %${MIN_SINGLE_COVERAGE} kapsam ve doğrulamada genel liderden iyi sonuç gerekir (${evidenceDetail})`}. Puan farkı olasılık değildir.`
      : "Tek koşabilir at var; bu bir tahmin üstünlüğü anlamına gelmez.";
    const metricTable = ranked.length ? `<details class="analysis-details"><summary>Detaylı analiz tablosu</summary><p class="hint">Puanlar yalnızca bu koşudaki göreli sıralamayı gösterir; kazanma olasılığı değildir. Eksik kaynak verileri gösterilmez.</p><div class="analysis-table-wrap" role="region" aria-label="Atların detaylı analiz tablosu" tabindex="0"><table class="analysis-table"><thead><tr><th scope="col">Sıra</th><th scope="col">At no</th><th scope="col">At adı</th><th scope="col">Genel</th><th scope="col">Form</th><th scope="col">Piyasa</th><th scope="col">Pedigri</th><th scope="col">HP</th><th scope="col">AGF</th><th scope="col">Oran</th><th scope="col">Son 6</th></tr></thead><tbody>${ranked.map((horse, index) => `<tr${index === 0 ? ' class="leader-row"' : ""}><td>${index + 1}</td><td>${Number.isSafeInteger(horse.number) && horse.number > 0 ? horse.number : "—"}</td><td>${escapeHtml(horse.name)}</td><td>${horse.score.toFixed(1)}</td><td>${horse.features.form === null ? "—" : horse.features.form.toFixed(1)}</td><td>${horse.features.market === null ? "—" : horse.features.market.toFixed(1)}</td><td>${horse.features.pedigree === null ? "—" : horse.features.pedigree.toFixed(1)}</td><td>${horse.hp === null ? "—" : horse.hp}</td><td>${horse.agf === null ? "—" : `%${horse.agf}`}</td><td>${horse.odds === null ? "—" : horse.odds}</td><td>${horse.last6 || "—"}</td></tr>`).join("")}</tbody></table></div></details>` : "";
    return `<article class="race">${heading}${signalNote}<p class="hint">${singleNote}</p>${ranked.length ? ranked.map((horse, index) => `<div class="horse"><strong class="horse-number"><small>AT NO</small>${Number.isSafeInteger(horse.number) && horse.number > 0 ? horse.number : "—"}</strong><span class="horse-info"><strong>${escapeHtml(horse.name || "İsimsiz at")}</strong>${index === 0 ? " <small class=\"leader-label\">Lider</small>" : ""}<small>${escapeHtml(horse.signal || "Sinyal yok")}</small></span><span class="score"><small>PUAN</small>${horse.score.toFixed(1)}</span><small class="horse-meta">${horse.agf === null ? "AGF yok" : `AGF %${horse.agf}`}${horse.odds === null ? " · Oran yok" : ` · Oran ${horse.odds}`}${horse.hp === null ? " · HP yok" : ` · HP ${horse.hp}`}</small></div>`).join("") : "<p class=muted>Koşabilir at bulunamadı.</p>"}${metricTable}</article>`;
  }).join("");
}
function buildCoupon(races, budget, unit) {
  if (races.length !== 6) return { error: "Altılı kupon için 6 okunabilir koşu gerekir." };
  const finishedNos = races.filter((race) => race.finished).map((race) => race.no);
  const openLegs = races.filter((race) => !race.finished).map((race) => ({ race, ranked: scoreRace(race) }));
  if (!openLegs.length) return { completedOnly: true, finishedNos };
  if (openLegs.some(({ ranked }) => !ranked.length)) return { error: "Açık ayaklardan birinde koşabilir at bulunamadı." };
  if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(unit) || unit <= 0) return { error: "Bütçe ve kolon fiyatı sıfırdan büyük olmalıdır." };
  const maxColumns = Math.floor(budget / unit);
  if (!Number.isSafeInteger(maxColumns)) return { error: "Bütçe, güvenli kolon hesabı sınırını aşıyor." };
  if (maxColumns < 1) return { error: "Bütçe, en az bir kolonun birim fiyatını karşılamıyor." };

  const picks = openLegs.map(({ race, ranked }) => {
    return {
      no: race.no,
      ranked,
      externalSignals: race.externalSignals || null,
      count: 1,
      singleEligible: isValidatedSingle(ranked)
    };
  });
  let fullColumns = 1;
  let allHorsesFit = true;
  for (const pick of picks) {
    if (fullColumns > maxColumns / pick.ranked.length) {
      allHorsesFit = false;
      break;
    }
    fullColumns *= pick.ranked.length;
  }

  let columns;
  let budgetForcedSingle = false;
  let budgetForcedMultipleSingles = false;
  if (allHorsesFit) {
    picks.forEach((pick) => { pick.count = pick.ranked.length; });
    columns = fullColumns;
  } else {
    let best = window.CouponOptimizer.optimizeCouponCounts(picks, maxColumns, false);
    if (!best) {
      best = window.CouponOptimizer.optimizeCouponCounts(picks, maxColumns, true);
      budgetForcedSingle = true;
    }
    if (!best) {
      best = window.CouponOptimizer.optimizeCouponCounts(picks, maxColumns, true, picks.length);
      budgetForcedSingle = true;
      budgetForcedMultipleSingles = Boolean(best);
    }
    if (!best) {
      const multiHorseLegs = picks.filter((pick) => pick.ranked.length > 1).length;
      const minimumColumns = multiHorseLegs ? 2 ** Math.max(0, multiHorseLegs - picks.length) : 1;
      const minimumBudget = Math.round(minimumColumns * unit * 100) / 100;
      return {
        error: `Bu altılı için ${budget.toFixed(2)} TL bütçe ${maxColumns} kolon ediyor; en az ${minimumColumns} kolon (${minimumBudget.toFixed(2)} TL) gerekiyor. Bütçeyi artırın veya kupon birim fiyatını düşürün.`,
        minimumColumns,
        minimumBudget
      };
    }
    picks.forEach((pick, index) => { pick.count = best.counts[index]; });
    columns = best.columns;
  }

  for (const pick of picks) {
    pick.budgetForcedSingle = budgetForcedSingle && pick.count === 1 && !pick.singleEligible && pick.ranked.length > 1;
    pick.budgetNarrowed = pick.count < pick.ranked.length && columns / pick.count * (pick.count + 1) > maxColumns;
  }
  const forcedSingleCount = picks.filter((pick) => pick.budgetForcedSingle).length;
  return { picks, columns, total: Math.round(columns * unit * 100) / 100, budget, maxColumns, budgetNarrowed: picks.some((pick) => pick.budgetNarrowed), budgetForcedSingle: forcedSingleCount > 0, budgetForcedMultipleSingles: budgetForcedMultipleSingles && forcedSingleCount > 1, forcedSingleCount, finishedNos };
}
function formatCoupon(coupon, poolTitle, poolKey) {
  if (coupon.error) return `<article class="card coupon-detail"><h3>${escapeHtml(poolTitle)}</h3><p class="coupon-intro">${escapeHtml(coupon.error)}</p></article>`;
  if (coupon.completedOnly) return `<article class="card coupon-detail"><h3>${escapeHtml(poolTitle)}</h3><p class="coupon-intro">Koşular tamamlandı; kupon oluşturulmadı.</p></article>`;

  const warning = coupon.budgetForcedMultipleSingles
    ? `<div class="alert">Bütçe nedeniyle ${coupon.forcedSingleCount} ayakta doğrulanmamış tek seçim var.</div>`
    : coupon.budgetForcedSingle
      ? `<div class="alert">Bütçe nedeniyle bir ayakta doğrulanmamış tek seçim var.</div>`
      : coupon.budgetNarrowed
        ? `<div class="alert">Bütçe bazı ayaklardaki at sayısını sınırladı.</div>`
        : "";
  const completed = coupon.finishedNos?.length ? `<p class="coupon-intro">Koşulan ayaklar: ${coupon.finishedNos.map((no) => `${no}. koşu`).join(", ")}</p>` : "";
  const legs = coupon.picks.map((pick) => {
    const labels = pick.ranked.slice(0, pick.count).map((horse) => `<span class="coupon-horse">${Number.isSafeInteger(horse.number) && horse.number > 0 ? `#${horse.number}` : "No belirtilmemiş"} ${escapeHtml(horse.name)}</span>`).join("");
    return `<li class="coupon-leg"><strong>${pick.no}. Koşu</strong><div class="coupon-horses">${labels}</div></li>`;
  }).join("");
  return `<article class="card coupon-detail"><header><h3>${escapeHtml(poolTitle)}</h3><p class="coupon-intro">Model kuponu</p></header>${warning}${completed}<ol class="coupon-legs">${legs}</ol><div class="coupon-total"><strong>${coupon.columns} kolon · ${coupon.total.toFixed(2)} TL</strong><span>Üst bütçe ${coupon.budget.toFixed(2)} TL</span></div><button class="btn secondary coupon-save" type="button" data-save-coupon="${poolKey}">Kuponu kaydet</button></article>`;
}
const POOL_KEYS = ["first", "second", "third", "fourth", "fifth", "sixth"];
const POOL_ORDINALS = ["Birinci", "İkinci", "Üçüncü", "Dördüncü", "Beşinci", "Altıncı"];
function getPoolKey(index) {
  return POOL_KEYS[index] || `pool${index + 1}`;
}
function getPoolLabel(poolKey) {
  const knownIndex = POOL_KEYS.indexOf(poolKey);
  if (knownIndex >= 0) return `${POOL_ORDINALS[knownIndex]} altılı`;
  const numberedPool = /^pool(\d+)$/.exec(poolKey);
  return numberedPool ? `Altılı ${numberedPool[1]}` : "Altılı";
}
function formatIncompletePool(races, start, title) {
  const availableNos = new Set(races.map((race) => race.no));
  const missingNos = Array.from({ length: 6 }, (_, index) => start + index).filter((no) => !availableNos.has(no));
  const missing = missingNos.length ? ` Eksik koşular: ${missingNos.join(", ")}.` : "";
  return `<div class="card"><h2>${title} · tamamlanmamış</h2><p class="hint">${availableNos.size}/6 koşu okundu.${missing} Mevcut koşuların ayrıntılı analizi aşağıda; eksikler tamamlanmadan kupon hesaplanmaz.</p></div>`;
}
async function analyze() {
  const input = $("hamBultenInput").value.trim();
  const warning = $("bultenUyariAlani");
  warning.innerHTML = "";
  $("dogrulamaRaporuAlani").innerHTML = "";
  $("kuponAlani").innerHTML = "";
  $("kosuSonucAlani").innerHTML = "";
  if (!input) { showMessage(warning, "Önce TJK bülten metnini yapıştırın.", "error"); return; }
  const parsed = parseRaces(input);
  if (!parsed.races.length) { showMessage(warning, parsed.warnings.join(" "), "error"); return; }
  const couponDate = $("couponDateInput")?.value || new Date().toISOString().slice(0, 10);
  const couponCity = $("couponCityInput")?.value.trim().slice(0, 80) || "";
  const externalSignals = window.TipSignals.parseAnalystSignals($("analystSignalInput")?.value || "");
  parsed.races.forEach((race) => { race.externalSignals = externalSignals[race.no] || null; });
  scoreCache = new WeakMap();
  const openRaces = parsed.races.filter((race) => !race.finished);
  const results = openRaces.length ? await analyzeRaces(openRaces) : [];
  lastAnalysis = openRaces.map((race, index) => ({
    no: race.no,
    date: couponDate,
    city: couponCity,
    surface: race.surface,
    type: race.type,
    distance: race.distance,
    modelVersion: MODEL_VERSION,
    externalSignals: parsed.races.find((race) => race.no === openRaces[index].no)?.externalSignals || null,
    horses: results[index].map((horse) => ({ number: horse.number, name: horse.name, score: horse.score, modelShare: horse.modelShare, features: horse.features, performanceScore: horse.performanceScore, marketScore: horse.marketScore, coverage: horse.coverage, independentCoverage: horse.independentCoverage, signal: horse.signal }))
  }));
  state.predictions = mergePredictionHistory(state.predictions, lastAnalysis);
  $("resultsDateInput").value = couponDate;
  $("resultsCityInput").value = couponCity;
  saveState();
  renderAnalysis(parsed.races);
  const completedCount = parsed.races.filter((race) => race.finished).length;
  const statusMessage = openRaces.length
    ? `${openRaces.length} açık koşu ortak modelle analiz edildi ve tahminler tarih/hipodrom bilgisiyle kişisel hafızaya kaydedildi; ${completedCount} koşulmuş ayak tahmin dışında bırakıldı.`
    : `${completedCount} koşunun tamamı koşulmuş; tahmin üretilmedi.`;
  if (parsed.warnings.length) showMessage(warning, `${statusMessage} ${parsed.warnings.join(" ")}`, "");
  else showMessage(warning, `${statusMessage} Açık ayaklarda AGF/oran piyasa sinyaliyle HP/form/pedigri bağımsız performans sinyalleri ayrıştırılır.`, "success");
  const budget = parseNumber($("butceInput").value);
  const unit = parseNumber($("birimInput").value);
  const sortedRaces = [...parsed.races].sort((a, b) => a.no - b.no);
  const firstRaceNo = sortedRaces[0].no;
  const lastRaceNo = sortedRaces[sortedRaces.length - 1].no;
  const poolCards = [];
  const poolStarts = [firstRaceNo];
  const secondPoolStart = lastRaceNo - 5;
  if (secondPoolStart > firstRaceNo) poolStarts.push(secondPoolStart);
  lastCoupons = {};
  for (const [poolIndex, start] of poolStarts.entries()) {
    const end = start + 5;
    const poolKey = getPoolKey(poolIndex);
    const poolLabel = POOL_ORDINALS[poolIndex] || `Altılı ${poolIndex + 1}`;
    const poolTitle = `${poolLabel} altılı · ${start}–${end}. koşular`;
    const poolLegs = sortedRaces.filter((race) => race.no >= start && race.no <= end);
    const availableNos = new Set(poolLegs.map((race) => race.no));
    const complete = Array.from({ length: 6 }, (_, index) => start + index).every((no) => availableNos.has(no));
    if (complete) {
      const coupon = buildCoupon(poolLegs, budget, unit);
      lastCoupons[poolKey] = coupon;
      poolCards.push(formatCoupon(coupon, poolTitle, poolKey));
    } else {
      poolCards.push(formatIncompletePool(poolLegs, start, poolTitle));
    }
  }
  $("kuponAlani").innerHTML = poolCards.join("");
  setTab("analiz");
}
function softmaxScores(horses, weights) {
  return window.RaceScoring.softmaxScores(horses, weights);
}
function brierScore(races, weights) {
  if (!races.length) return Infinity;
  return races.reduce((total, race) => {
    const probabilities = softmaxScores(race.horses, weights);
    return total + probabilities.reduce((sum, probability, index) => sum + (probability - (race.horses[index].number === race.winner ? 1 : 0)) ** 2, 0);
  }, 0) / races.length;
}
function projectWeights(weights) {
  const positive = Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, Math.max(0.02, weights[key])]));
  const total = Object.values(positive).reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, positive[key] / total]));
}
function fitModelWeights(races, referenceWeights, protectedWeights = referenceWeights) {
  if (races.length < MODEL_MIN_RACES) return null;
  const dates = [...new Set(races.map((race) => String(race.at || "").slice(0, 10)).filter(Boolean))].sort();
  if (dates.length < 5) return null;
  const validationStartIndex = Math.floor(dates.length * 0.8);
  const validationStartDate = dates[validationStartIndex];
  const training = races.filter((race) => String(race.at || "").slice(0, 10) < validationStartDate);
  const validation = races.filter((race) => String(race.at || "").slice(0, 10) >= validationStartDate);
  if (training.length < MODEL_MIN_RACES || validation.length < 5) return null;
  let candidate = { ...referenceWeights };
  for (let epoch = 0; epoch < 300; epoch++) {
    const gradient = Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, 0]));
    for (const race of training) {
      const probabilities = softmaxScores(race.horses, candidate);
      race.horses.forEach((horse, index) => {
        const features = horse.features || {};
        const actual = horse.number === race.winner ? 1 : 0;
        const residual = (probabilities[index] - actual) / 12.5;
        const available = Object.entries(features).filter(([, value]) => Number.isFinite(value));
        const totalWeight = available.reduce((sum, [key]) => sum + candidate[key], 0);
        if (!totalWeight) return;
        const score = available.reduce((sum, [key, value]) => sum + value * candidate[key], 0) / totalWeight;
        for (const [key, value] of available) gradient[key] += residual * (value - score) / totalWeight;
      });
    }
    const rate = 0.08 / training.length;
    candidate = projectWeights(Object.fromEntries(Object.keys(BASE_WEIGHTS).map((key) => [key, candidate[key] - rate * (gradient[key] + 0.15 * (candidate[key] - referenceWeights[key]))])));
  }
  const baselineBrier = brierScore(validation, referenceWeights);
  const protectedBrier = brierScore(validation, protectedWeights);
  const learnedBrier = brierScore(validation, candidate);
  const updated = learnedBrier < baselineBrier * 0.98 && learnedBrier < protectedBrier;
  return { sampleSize: races.length, trainingRaces: training.length, validationRaces: validation.length, validationStartDate, baselineBrier, protectedBrier, validationBrier: updated ? learnedBrier : protectedBrier, updated, weights: updated ? candidate : protectedWeights };
}
function renderTrainingReport() {
  const target = $("trainingReportArea");
  if (!target) return;
  const report = state.trainingReport || {};
  const comparison = window.RaceLearningEvaluation.evaluateForwardComparison(state.outcomes, BASE_WEIGHTS);
  if (!report.sampleSize && !comparison.validated) {
    target.textContent = `Öğrenme raporu: ${state.outcomes.length.toLocaleString("tr-TR")} kayıtlı sonuç · ileri tarih kıyaslaması için en az 5 ayrı yarış tarihi gerekir.`;
    return;
  }
  const currentValidation = report.validationMethod === "fixed-forward-v1";
  const modelStatus = currentValidation ? report.updated ? "Yeni ağırlıklar sabit temel modele karşı ileri tarih doğrulamasını geçti ve etkinleştirildi." : report.verified ? "Yeni ağırlıklar doğrulama eşiğini geçmedi; son iyi ağırlıklar korundu." : `Doğrulama için yeterli veri yok (en az ${MODEL_MIN_RACES} yarış).` : "Kayıtlı model eski doğrulama yöntemiyle eğitilmiş; sonraki yeni sonuçlarda sabit temel ve son iyi modelle yeniden doğrulanacak.";
  const metrics = comparison.validated ? ["learned", "favorite", "fixed"].map((key) => {
    const item = comparison.byModel[key];
    return `${key === "learned" ? "tahmin anındaki model" : key === "favorite" ? "piyasa favorisi" : "sabit temel model"}: ${item.races ? `${item.wins}/${item.races} (%${(item.hitRate * 100).toFixed(1)})` : "ölçülemedi"}`;
  }).join(" · ") : "İleri tarih karşılaştırması için henüz yeterli tarih yok.";
  const segments = comparison.byContext.filter((item) => item.eligible).map((item) => `${item.name} (${item.kind === "surface" ? "zemin" : "yarış türü"}, n=${item.races})`).join(", ");
  target.textContent = `Öğrenme raporu: ${report.sampleSize || state.outcomes.length} uygun yarış · eğitim ${report.trainingRaces || 0} · doğrulama ${report.validationRaces || 0}${report.validationStartDate ? ` (${report.validationStartDate} sonrası)` : ""}. ${modelStatus} Brier temel: ${currentValidation && Number.isFinite(report.baselineBrier) ? report.baselineBrier.toFixed(4) : "—"} · doğrulama: ${currentValidation && Number.isFinite(report.validationBrier) ? report.validationBrier.toFixed(4) : "—"}. ${comparison.validated ? `Aynı son tarih dilimi (${comparison.startDate}–${comparison.endDate}, n=${comparison.races}): ${metrics}` : "İleri tarih kıyaslaması için beş ayrı tarihe yayılmış, yarış öncesinde kaydedilmiş sonuç bulunamadı"}. Yeterli örnekli zemin/tür: ${segments || `henüz yok (eşik ${comparison.minimumContextSample})`}. Sızıntıyı önlemek için TJK arşivinden sonradan puanlanan kayıtlar bu kıyasa dahil edilmez; yalnız yarış öncesi saklanan tahminler kullanılır. Ağırlık sürümü: ${(state.modelWeightVersions || []).at(-1)?.version || 0}.`;
}
function trainModel() {
  const races = state.outcomes.filter((item) => Array.isArray(item.horses) && item.horses.length > 1 && item.horses.some((horse) => horse.number === item.winner)).sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))).slice(-TRAINING_WINDOW_RACES);
  const globalFit = fitModelWeights(races, BASE_WEIGHTS, state.lastGoodModelWeights || state.modelWeights);
  const validatedAt = new Date().toISOString();
  let weightsChanged = false;
  if (globalFit?.updated) {
    state.modelWeights = { ...globalFit.weights };
    state.lastGoodModelWeights = { ...globalFit.weights };
    weightsChanged = true;
  }
  state.trainingReport = {
    sampleSize: races.length,
    trainingRaces: globalFit?.trainingRaces ?? 0,
    validationRaces: globalFit?.validationRaces ?? 0,
    validationStartDate: globalFit?.validationStartDate ?? null,
    minimum: MODEL_MIN_RACES,
    baselineBrier: globalFit?.baselineBrier ?? null,
    validationBrier: globalFit?.validationBrier ?? null,
    updated: Boolean(globalFit?.updated),
    verified: Boolean(globalFit),
    validationMethod: "fixed-forward-v1",
    validatedAt: globalFit ? validatedAt : null
  };
  const contexts = new Map();
  for (const race of races) {
    if (!race.surface || !race.type) continue;
    for (const key of window.RaceScoring.raceContextKeys(race)) {
      if (!contexts.has(key)) contexts.set(key, []);
      contexts.get(key).push(race);
    }
  }
  const contextWeights = {};
  const contextReports = {};
  for (const [key, contextRaces] of contexts) {
    const protectedContext = state.contextWeights?.[key] || state.modelWeights;
    const fit = fitModelWeights(contextRaces, BASE_WEIGHTS, protectedContext);
    if (!fit) continue;
    if (fit.updated) {
      contextWeights[key] = fit.weights;
      weightsChanged = true;
    }
    contextReports[key] = { sampleSize: fit.sampleSize, updated: fit.updated, validationBrier: fit.validationBrier };
  }
  state.contextWeights = { ...(state.contextWeights || {}), ...contextWeights };
  state.contextReports = { ...(state.contextReports || {}), ...contextReports };
  if (weightsChanged) {
    state.modelWeightVersions = [...(state.modelWeightVersions || []), {
      version: (state.modelWeightVersions?.at(-1)?.version || 0) + 1,
      weights: { ...state.modelWeights },
      contextWeights: { ...state.contextWeights },
      createdAt: validatedAt,
      baselineBrier: globalFit?.baselineBrier ?? null,
      validationBrier: globalFit?.validationBrier ?? null,
      validationStartDate: globalFit?.validationStartDate ?? null
    }].slice(-20);
  }
  renderTrainingReport();
}
function outcomeKey(item) {
  return window.RaceLearningEvaluation.identity(item);
}
function archiveRowToOutcome(row) {
  const program = row.program || {};
  const results = row.results || {};
  const runners = Array.isArray(program.runners) ? program.runners : [];
  const resultRunners = Array.isArray(results.runners) ? results.runners : [];
  const finishByNumber = new Map(resultRunners.map((runner) => [Number(runner.horseNumber ?? runner.no), Number(runner.finishPosition)]));
  const winner = [...finishByNumber.entries()].find(([, place]) => place === 1)?.[0];
  if (winner === undefined || runners.length < 2) return null;
  const title = String(program.title || "");
  const distanceAndSurface = title.match(/(\d{3,4})\s*(Kum|Çim|Sentetik)/i);
  const normalizedTitle = normalize(title);
  const surface = distanceAndSurface?.[2] || "Belirtilmemiş";
  const type = normalizedTitle.includes("HANDIKAP") ? "HANDIKAP" : normalizedTitle.includes("MAIDEN") || normalizedTitle.includes("SATIS") ? "MAIDEN / SATIŞ" : "DİĞER";
  const race = {
    no: Number(row.race_no),
    date: String(row.race_date || "").slice(0, 10),
    raceType: String(program.raceType || program.raceCategory || title),
    distance: distanceAndSurface ? Number(distanceAndSurface[1]) : 1400,
    surface,
    type,
    horses: runners.map((runner) => {
      const form = String(runner.form || "").replace(/[^1-9]/g, "").slice(0, 6);
      const hp = Number(runner.handicapPoints);
      const agf = Number(runner.agf);
      const odds = Number(runner.odds);
      return {
        number: Number(runner.horseNumber ?? runner.no),
        name: String(runner.name || ""),
        hp: Number.isFinite(hp) && hp > 0 ? hp : null,
        agf: Number.isFinite(agf) && agf > 0 ? agf : null,
        odds: Number.isFinite(odds) && odds > 0 ? odds : null,
        last6: form,
        sire: String(runner.sire || ""),
        damSire: String(runner.damSire || ""),
        scratched: Boolean(runner.scratched)
      };
    })
  };
  const scored = scoreRace(race);
  const winningHorse = scored.find((horse) => horse.number === winner);
  if (!winningHorse) return null;
  const marketFavorite = scored.filter((horse) => horse.marketScore !== null).sort((a, b) => b.marketScore - a.marketScore)[0];
  const singleGap = scored.length > 1 ? scored[0].score - scored[1].score : 0;
    const singleCandidate = singleGap >= SINGLE_GAP_THRESHOLD && scored[0].independentCoverage >= MIN_SINGLE_COVERAGE;
  return {
    raceNo: race.no,
    city: String(row.city || ""),
    sourceKey: `tjk:${String(row.race_date || "").slice(0, 10)}:${String(row.city || "")}:${race.no}`,
    winner,
    winnerName: winningHorse.name,
    top3Hit: scored.slice(0, 3).some((horse) => horse.number === winner),
    top1Hit: scored[0]?.number === winner,
    favoriteMiss: marketFavorite ? marketFavorite.number !== winner : null,
    singleGap,
    singleCandidate,
    singleHit: singleCandidate && scored[0].number === winner,
    surpriseHit: winningHorse.signal === "Sürpriz adayı",
    horses: scored.map((horse) => ({ number: horse.number, name: horse.name, score: horse.score, features: horse.features, performanceScore: horse.performanceScore, marketScore: horse.marketScore, coverage: horse.coverage, independentCoverage: horse.independentCoverage, signal: horse.signal })),
    surface,
    type,
    distance: race.distance,
    at: `${String(row.race_date || "").slice(0, 10)}T12:00:00.000Z`
  };
}
async function refreshRemoteMemory() {
  const target = $("cloudMemoryArea");
  if (!target) return;
  try {
    const response = await fetch("/api/model-memory", { headers: { Accept: "application/json" } });
    const memory = await response.json();
    if (!response.ok) throw new Error(memory.error || "Neon hafızası alınamadı.");
    target.textContent = `Kalıcı Neon hafızası: ${Number(memory.completedRaceCount || 0).toLocaleString("tr-TR")} sonuçlu TJK koşusu · ${memory.firstDate || "—"} – ${memory.lastDate || "—"}. Bu resmi arşiv tüm kurulumlarda ortak kullanılır; kişisel analiz geçmişi bu cihazda kalır.`;
  } catch {
    target.textContent = "Neon kalıcı hafızasına şu an ulaşılamıyor; bu cihazdaki kayıtlar korunuyor.";
  }
}
async function syncHistoricalArchive() {
  const status = $("archiveStatus");
  if (status) status.textContent = "TJK geçmiş arşivi kontrol ediliyor…";
  refreshRemoteMemory();
  try {
    const archive = [];
    const pageSize = 5000;
    for (let offset = 0; offset < 100000; offset += pageSize) {
      const response = await fetch(`/api/race-history?limit=${pageSize}&offset=${offset}`, { headers: { Accept: "application/json" } });
      const page = await response.json();
      if (!response.ok) throw new Error(page.error || "Arşiv hizmetine ulaşılamadı.");
      if (!Array.isArray(page)) throw new Error("Arşiv yanıt biçimi beklenmiyor.");
      archive.push(...page);
      if (page.length < pageSize) break;
    }
    classHistoryArchive = window.RaceClassHistory.createIndex(archive);
    scoreCache = new WeakMap();
    const converted = archive.map(archiveRowToOutcome).filter(Boolean);
    let freshCount = 0;
    let correctedCount = 0;
    let refreshedClassHistoryCount = 0;
    for (const item of converted) {
      const existingIndex = state.outcomes.findIndex((outcome) => outcomeKey(outcome) === outcomeKey(item));
      const existing = existingIndex >= 0 ? state.outcomes[existingIndex] : null;
      const existingHorses = new Map((existing?.horses || []).map((horse) => [Number(horse.number), horse]));
      const classHistoryChanged = existing?.sourceKey?.startsWith("tjk:") && item.horses.some((horse) => {
        const previousFeature = existingHorses.get(Number(horse.number))?.features?.classHistory;
        return Number.isFinite(horse.features?.classHistory) && previousFeature !== horse.features.classHistory;
      });
      if (classHistoryChanged) {
        state.outcomes[existingIndex] = item;
        refreshedClassHistoryCount += 1;
        continue;
      }
      const merged = window.RaceLearningEvaluation.mergeOutcome(state.outcomes, item);
      state.outcomes = merged.outcomes;
      freshCount += Number(merged.added);
      correctedCount += Number(merged.corrected);
    }
    if (freshCount || correctedCount || refreshedClassHistoryCount) trainModel();
    state.archiveRaceCount = converted.length;
    state.archiveLatestDate = archive.map((row) => String(row.race_date || "").slice(0, 10)).sort().at(-1) || "";
    state.archiveSyncedAt = new Date().toISOString();
    saveState();
    renderTrainingReport();
    if (status) status.textContent = `Neon arşivinden ${converted.length.toLocaleString("tr-TR")} sonuçlu koşu alındı; ${freshCount.toLocaleString("tr-TR")} yeni koşu eklendi; ${correctedCount.toLocaleString("tr-TR")} eski sonuç düzeltildi. Son arşiv tarihi: ${state.archiveLatestDate || "bilinmiyor"}. ${state.trainingReport?.updated ? "Ayrılmış doğrulamada iyileşme görüldü; öğrenilmiş ağırlıklar etkin." : `Ağırlıklar ${MODEL_MIN_RACES} yarış ve ayrılmış doğrulama iyileşmesi şartıyla güncellenir.`}`;
  } catch {
    if (status) status.textContent = "Neon yarış arşivine şu an ulaşılamadı. Bu cihazdaki kayıtlar korunuyor; bağlantı kurulduğunda arşiv yeniden kontrol edilir.";
  }
}
let selectedResultImage = null;
let resultImagePreviewUrl = null;
function setResultImageStatus(message, isError = false) {
  const status = $("resultsImageStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}
function readImageAsJpeg(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const sourceUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(sourceUrl);
      const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("Görsel dönüştürülemedi."));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Görsel küçültülemedi."));
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Görsel okunamadı."));
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.82);
    };
    image.onerror = () => { URL.revokeObjectURL(sourceUrl); reject(new Error("Bu görsel açılamadı.")); };
    image.src = sourceUrl;
  });
}
async function extractResultsFromImage() {
  if (!selectedResultImage) return;
  const button = $("readResultsImageButton");
  button.disabled = true;
  button.textContent = "Görsel okunuyor…";
  setResultImageStatus("Görsel küçültülüyor ve sonuç tablosu okunuyor…");
  try {
    const image = await readImageAsJpeg(selectedResultImage);
    const response = await fetch("/api/result-image-ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Görsel okunamadı. Daha net bir görüntü seçip tekrar deneyin.");
    const recognizedText = String(payload.text || "").trim();
    if (!recognizedText) throw new Error("Görselde okunabilir sonuç metni bulunamadı.");
    const textarea = $("sonucluBultenInput");
    textarea.value = [textarea.value.trim(), recognizedText].filter(Boolean).join("\n\n");
    textarea.focus();
    setResultImageStatus("Metin taslağı eklendi. Koşu ve sıra bilgilerini kontrol edin; ardından sonuçları eşleştirip önizleyin.");
  } catch (error) {
    setResultImageStatus(error instanceof Error ? error.message : "Görsel işlenemedi. Lütfen yeniden deneyin.", true);
  } finally {
    button.disabled = !selectedResultImage;
    button.textContent = "Görselden metni oku";
  }
}
function compareResults() {
  pendingResultImport = null;
  const target = $("ogrenmeLogAlani");
  const parsed = parseRaces($("sonucluBultenInput").value.trim());
  if (!parsed.races.length) {
    showMessage(target, "Sonuç bülteninde koşu ve at sonuç satırları bulunamadı. Ekran görüntüsündeki metin bir web menüsü/başlık içeriği; sonuç tablosunu, at numarası ve Sıra/Rank/Position bilgileriyle birlikte kopyalayın.", "error");
    return;
  }
  const resultDate = $("resultsDateInput").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resultDate) || Number.isNaN(Date.parse(`${resultDate}T00:00:00Z`)) || new Date(`${resultDate}T00:00:00Z`).toISOString().slice(0, 10) !== resultDate) { showMessage(target, "Sonuç bülteninin geçerli tarihini seçin.", "error"); return; }
  if (new Set(parsed.races.map((race) => race.no)).size !== parsed.races.length) { showMessage(target, "Sonuç bülteninde aynı koşu numarası birden fazla bulundu. Yinelenen koşuyu kaldırıp yeniden deneyin.", "error"); return; }
  const datePredictions = state.predictions.filter((item) => item.date === resultDate);
  if (!datePredictions.length) { showMessage(target, `${resultDate} tarihi için kaydedilmiş tahmin bulunamadı. Önce o günün bültenini analiz edin.`, "error"); return; }
  const matchingCities = [...new Set(datePredictions.map((item) => normalize(item.city || "")))];
  let resultCity = normalize($("resultsCityInput").value.trim());
  if (!resultCity && matchingCities.length > 1) { showMessage(target, "Aynı tarihte birden fazla hipodromun tahmini kayıtlı. Eşleştirmek için hipodrom adını girin.", "error"); return; }
  if (!resultCity) resultCity = matchingCities[0] || "";
  const matchingPredictions = datePredictions.filter((item) => normalize(item.city || "") === resultCity);
  if (!matchingPredictions.length) {
    const savedCities = [...new Set(datePredictions.map((item) => item.city).filter(Boolean))];
    const savedCityHint = savedCities.length ? ` Bu tarihte kayıtlı hipodrom: ${savedCities.join(", ")}.` : "";
    showMessage(target, `Bu tarih ve hipodrom için kayıtlı tahmin bulunamadı. Analiz sırasında kaydettiğiniz hipodrom adını aynen kullanın.${savedCityHint}`, "error");
    return;
  }
  const timestamp = new Date().toISOString();
  const outcomes = [];
  let racesWithoutWinner = 0;
  let racesWithoutPrediction = 0;
  for (const race of parsed.races) {
    const winner = race.horses.find((horse) => horse.place === 1);
    const prediction = matchingPredictions.find((item) => item.no === race.no);
    if (!winner || !Number.isSafeInteger(Number(winner.number)) || Number(winner.number) < 1) { racesWithoutWinner += 1; continue; }
    if (!prediction) { racesWithoutPrediction += 1; continue; }
    const top3 = prediction.horses.slice(0, 3);
    const marketFavorite = prediction.horses.filter((horse) => horse.marketScore !== null).sort((a, b) => b.marketScore - a.marketScore)[0];
    const winnerPrediction = prediction.horses.find((horse) => horse.number === winner.number);
    const singleGap = prediction.horses.length > 1 ? prediction.horses[0].score - prediction.horses[1].score : 0;
    const singleCandidate = singleGap >= SINGLE_GAP_THRESHOLD && prediction.horses[0].independentCoverage >= MIN_SINGLE_COVERAGE;
    outcomes.push({
      city: prediction.city || "",
      raceNo: race.no,
      sourceKey: `${prediction.date || resultDate}:${prediction.city || ""}:${race.no}`,
      winner: winner.number,
      winnerName: winner.name,
      modelVersion: prediction.modelVersion === MODEL_VERSION ? MODEL_VERSION : "legacy-ensemble-v0",
      top3Hit: top3.some((horse) => horse.number === winner.number),
      top1Hit: top3[0]?.number === winner.number,
      favoriteMiss: marketFavorite ? marketFavorite.number !== winner.number : null,
      surpriseHit: winnerPrediction?.signal === "Sürpriz adayı",
      singleGap,
      singleCandidate,
      singleHit: singleCandidate && prediction.horses[0].number === winner.number,
      horses: prediction.horses,
      surface: prediction.surface,
      type: prediction.type,
      distance: prediction.distance,
      at: `${prediction.date || timestamp.slice(0, 10)}T12:00:00.000Z`
    });
  }
  if (!outcomes.length) {
    const reason = racesWithoutWinner === parsed.races.length
      ? "Sonuç bülteninde birinci sırası okunamadı. Sıra/Rank/Position sütununu ve at numaralarını içeren tabloyu kopyalayın."
      : "Sonuçlarda birinci bilgisi bulundu ancak bu tarih ve hipodromda aynı numaralı kayıtlı tahmin bulunamadı.";
    showMessage(target, reason, "error");
    return;
  }
  pendingResultImport = { outcomes, resultDate, resultCity, racesWithoutWinner, racesWithoutPrediction };
  const existingById = new Map(state.outcomes.map((item) => [window.RaceLearningEvaluation.identity(item), item]));
  const corrections = outcomes.filter((item) => Number(existingById.get(window.RaceLearningEvaluation.identity(item))?.winner) !== Number(item.winner) && existingById.has(window.RaceLearningEvaluation.identity(item))).length;
  const newCount = outcomes.filter((item) => !existingById.has(window.RaceLearningEvaluation.identity(item))).length;
  const skipped = racesWithoutWinner + racesWithoutPrediction;
  target.setAttribute("role", "status");
  target.setAttribute("aria-live", "polite");
  target.innerHTML = `<div class="alert"><b>Kaydetmeden önce kontrol edin · ${escapeHtml(resultDate)} · ${escapeHtml(resultCity)}</b><br>${outcomes.length} eşleşen koşu · ${newCount} yeni sonuç · ${corrections} düzeltme adayı · ${skipped} atlanan koşu (birincisi okunamadı: ${racesWithoutWinner}, tahmini eşleşmedi: ${racesWithoutPrediction}). Görselden/metinden okunan kazanan numarası ve at adlarını doğrulayın.</div>${outcomes.map((item) => `<div class="alert">${item.raceNo}. koşu · Kazanan #${item.winner} ${escapeHtml(item.winnerName)} · model lideri ${item.top1Hit ? "isabet" : "isabet değil"}</div>`).join("")}<div class="actions"><button class="btn green" id="confirmResultsButton" type="button">Bu sonuçları onayla ve kaydet</button><button class="btn secondary" id="cancelResultsButton" type="button">İptal</button></div>`;
  $("confirmResultsButton").addEventListener("click", () => {
    if (!pendingResultImport) return;
    let added = 0;
    let corrected = 0;
    let duplicates = 0;
    for (const item of pendingResultImport.outcomes) {
      const result = window.RaceLearningEvaluation.mergeOutcome(state.outcomes, item);
      state.outcomes = result.outcomes;
      added += Number(result.added);
      corrected += Number(result.corrected);
      duplicates += Number(!result.added && !result.corrected);
    }
    if (added || corrected) trainModel();
    saveState();
    const imported = pendingResultImport;
    pendingResultImport = null;
    const report = state.trainingReport || {};
    target.innerHTML = `<div class="alert success"><b>Sonuçlar onaylandı.</b> ${added} yeni kayıt işlendi · ${corrected} eski sonuç düzeltildi · ${duplicates} yinelenen kayıt değişmedi · ${imported.racesWithoutWinner + imported.racesWithoutPrediction} koşu atlandı. Eğitim: ${report.updated ? "doğrulama geçti, yeni ağırlıklar etkin" : report.verified ? "eşik geçilmedi, son iyi ağırlıklar korundu" : `henüz doğrulanmadı (en az ${MODEL_MIN_RACES} uygun yarış gerekir)`}. Ağırlık sürümü ${(state.modelWeightVersions || []).at(-1)?.version || 0}.</div>`;
    renderTrainingReport();
    updateMemory();
  });
  $("cancelResultsButton").addEventListener("click", () => {
    pendingResultImport = null;
    target.textContent = "Sonuç kaydı iptal edildi; öğrenme hafızası değiştirilmedi.";
  });
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function handleCompareResults() {
  try {
    compareResults();
  } catch {
    showMessage($("ogrenmeLogAlani"), "Sonuçlar işlenirken beklenmeyen bir hata oluştu. Girdi alanlarını kontrol edip yeniden deneyin; kayıtlı hafıza korunuyor.", "error");
  }
}
const COUPON_STATUS_LABELS = { pending: "Sonuç bekleniyor", won: "Ödeme aldı", lost: "İsabetsiz", carryover: "Devretti" };
function createCouponId() {
  return window.crypto?.randomUUID?.() || `coupon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function saveGeneratedCoupon(poolKey) {
  const coupon = lastCoupons[poolKey];
  if (!coupon || coupon.error || coupon.completedOnly) return;
  const date = $("couponDateInput")?.value || lastAnalysis[0]?.date || new Date().toISOString().slice(0, 10);
  const city = $("couponCityInput")?.value.trim().slice(0, 80) || "";
  const record = {
    id: createCouponId(), date, city, poolType: poolKey, cost: coupon.total, payout: null, status: "pending",
    source: "Yarış Robotu", columns: coupon.columns, unit: parseNumber($("birimInput")?.value),
    modelVersion: MODEL_VERSION,
    legs: coupon.picks.map((pick) => ({ raceNo: pick.no, externalSignals: pick.externalSignals || null, horses: pick.ranked.slice(0, pick.count).map((horse) => ({ number: horse.number, name: horse.name, modelShare: horse.modelShare })) })),
    legResults: [],
    finishedNos: coupon.finishedNos || [],
    createdAt: new Date().toISOString()
  };
  state.coupons.unshift(record);
  state.coupons = state.coupons.slice(0, 500);
  saveState();
  renderCouponHistory();
  const poolLabel = getPoolLabel(poolKey);
  const status = document.createElement("div");
  status.className = "alert success";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = `${poolLabel} model kuponu sonuç takibine eklendi. Sonucu ve ödeme tutarını daha sonra kaydedebilirsiniz.`;
  $("kuponAlani").prepend(status);
}
function addManualCoupon(event) {
  event.preventDefault();
  const cost = parseNumber($("manualCouponCost").value);
  const payout = parseNumber($("manualCouponPayout").value);
  const date = $("manualCouponDate").value;
  const status = $("manualCouponStatus").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(cost) || cost <= 0 || !Number.isFinite(payout) || payout < 0 || !Object.hasOwn(COUPON_STATUS_LABELS, status)) {
    showMessage($("ogrenmeLogAlani"), "Tarih, pozitif kupon maliyeti, geçerli durum ve sıfır veya daha yüksek ödeme girin.", "error");
    return;
  }
  const record = {
    id: createCouponId(), date, city: $("manualCouponCity").value.trim().slice(0, 80),
    poolType: $("manualCouponPool").value, cost, payout: status === "pending" ? null : payout, status,
    source: "Harici kupon", columns: null, unit: null, legs: [], createdAt: new Date().toISOString()
  };
  state.coupons.unshift(record);
  state.coupons = state.coupons.slice(0, 500);
  saveState();
  showMessage($("ogrenmeLogAlani"), "Harici kupon kaydedildi. Devir durumu kazanç olarak sayılmaz; ödeme ayrıca girilir.", "success");
  event.currentTarget.reset();
  $("manualCouponDate").value = $("couponDateInput")?.value || new Date().toISOString().slice(0, 10);
  $("manualCouponPayout").value = "0";
}
function findSavedPrediction(date, city, raceNo) {
  return state.predictions.find((prediction) => prediction.date === date && normalize(prediction.city || "") === normalize(city || "") && Number(prediction.no) === Number(raceNo));
}
function updateCouponResult(id, card) {
  const record = state.coupons.find((coupon) => coupon.id === id);
  const status = card.querySelector("[data-coupon-status]")?.value;
  const payoutValue = card.querySelector("[data-coupon-payout]")?.value;
  const payout = payoutValue === "" ? null : parseNumber(payoutValue);
  if (!record || !Object.hasOwn(COUPON_STATUS_LABELS, status) || (status !== "pending" && (!Number.isFinite(payout) || payout < 0))) {
    showMessage($("ogrenmeLogAlani"), "Sonucu bekleyen olarak bırakın veya geçerli bir ödeme tutarı girin.", "error");
    return;
  }
  const legResults = new Map((record.legResults || []).map((result) => [Number(result.raceNo), Number(result.winnerNumber)]));
  for (const input of card.querySelectorAll("[data-leg-result]")) {
    if (!input.value.trim()) continue;
    const raceNo = Number(input.dataset.legResult);
    const winnerNumber = Number(input.value);
    if (!Number.isSafeInteger(winnerNumber) || winnerNumber < 1) {
      showMessage($("ogrenmeLogAlani"), "Ayak kazananı için 1 veya daha büyük geçerli at numarası girin.", "error");
      return;
    }
    legResults.set(raceNo, winnerNumber);
  }
  record.legResults = [...legResults].map(([raceNo, winnerNumber]) => ({ raceNo, winnerNumber }));
  record.status = status;
  record.payout = status === "pending" ? null : payout;
  record.resolvedAt = status === "pending" ? null : new Date().toISOString();
  let learnedLegs = 0;
  let correctedLegs = 0;
  for (const result of record.legResults) {
    const prediction = findSavedPrediction(record.date, record.city, result.raceNo);
    const outcome = prediction && window.CouponLearning.outcomeFromPrediction(prediction, result.winnerNumber);
    if (!outcome) continue;
    const identity = window.CouponLearning.raceIdentity(outcome);
    const existingIndex = state.outcomes.findIndex((item) => window.CouponLearning.raceIdentity(item) === identity);
    if (existingIndex < 0) {
      state.outcomes.push(outcome);
      learnedLegs += 1;
    } else if (Number(state.outcomes[existingIndex].winner) !== Number(outcome.winner)) {
      state.outcomes[existingIndex] = outcome;
      learnedLegs += 1;
      correctedLegs += 1;
    }
  }
  if (learnedLegs) trainModel();
  saveState();
  renderCouponHistory();
  const learningNote = learnedLegs
    ? ` ${learnedLegs} ayak tam tahmin kaydıyla eşleşip öğrenme hafızasına alındı${correctedLegs ? `; ${correctedLegs} eski sonuç düzeltildi` : ""}. ${state.trainingReport?.updated ? "Ayrılmış doğrulama iyileşti; güncellenmiş ağırlıklar etkin." : "Ağırlıklar yalnızca yeterli veri ve ileri tarihli doğrulama iyileşmesiyle güncellenir."}`
    : " Eşleşen yeni tam tahmin bulunmadığından model eğitimi için yeni yarış eklenmedi; kupon/ödeme kaydı saklandı.";
  showMessage($("ogrenmeLogAlani"), `Kupon ve ayak sonuçları kaydedildi.${learningNote}`, "success");
}
function renderCouponHistory() {
  const target = $("couponHistoryArea");
  const metrics = $("couponMetrics");
  if (!target || !metrics) return;
  const records = Array.isArray(state.coupons) ? state.coupons : [];
  const resolved = records.filter((record) => ["won", "lost"].includes(record.status) && Number.isFinite(Number(record.payout)));
  const carryovers = records.filter((record) => record.status === "carryover");
  const cost = resolved.reduce((sum, record) => sum + Number(record.cost || 0), 0);
  const payout = resolved.reduce((sum, record) => sum + Number(record.payout || 0), 0);
  const net = payout - cost;
  const roi = cost > 0 ? (net / cost) * 100 : null;
  const baselineRecords = records.filter((record) => record.source === "Yarış Robotu");
  const baselineResolved = baselineRecords.filter((record) => ["won", "lost"].includes(record.status) && Number.isFinite(Number(record.payout)));
  const baselineCost = baselineResolved.reduce((sum, record) => sum + Number(record.cost || 0), 0);
  const baselineNet = baselineResolved.reduce((sum, record) => sum + Number(record.payout || 0) - Number(record.cost || 0), 0);
  const baselineRoi = baselineCost > 0 ? (baselineNet / baselineCost) * 100 : null;
  const legDiagnostics = records.flatMap((record) => (record.legResults || []).map((result) => {
    const prediction = findSavedPrediction(record.date, record.city, result.raceNo);
    return window.CouponLearning.analyzePredictionResult(prediction, result.winnerNumber, record.legs?.find((leg) => Number(leg.raceNo) === Number(result.raceNo))?.horses?.map((horse) => horse.number) || []);
  }));
  const matchedLegDiagnostics = legDiagnostics.filter((item) => item.matched);
  const money = (value) => `${Number(value).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
  const metric = (label, value) => {
    const item = document.createElement("div");
    item.className = "stat";
    const title = document.createElement("span");
    title.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    item.append(title, strong);
    return item;
  };
  metrics.replaceChildren(
    metric("Tüm kaynaklar · kupon", records.length.toLocaleString("tr-TR")),
    metric("Tüm kaynaklar · sonuçlanan", resolved.length.toLocaleString("tr-TR")),
    metric("Tüm kaynaklar · maliyet", money(cost)),
    metric("Tüm kaynaklar · net ödeme farkı", resolved.length ? money(net) : "—"),
    metric("Tüm kaynaklar · getiri / maliyet", roi === null ? "—" : `${roi.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`),
    metric("Devreden kupon", carryovers.length.toLocaleString("tr-TR")),
    metric("Ana model kuponu / sonuçlanan", `${baselineRecords.length} / ${baselineResolved.length}`),
    metric("Ana model net ödeme farkı", baselineResolved.length ? money(baselineNet) : "—"),
    metric("Ana model net getiri / maliyet", baselineRoi === null ? "—" : `${baselineRoi.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`),
    metric("Tahminle eşleşen ayak sonucu", `${matchedLegDiagnostics.length} / ${legDiagnostics.length}`),
    metric("Model ilk 3 içinde · kupon isabeti", `${matchedLegDiagnostics.filter((item) => item.top3Hit).length} / ${matchedLegDiagnostics.length}`)
  );
  if (!records.length) {
    target.innerHTML = '<p class="muted">Henüz kupon kaydı yok. Analizden üretilen kuponu kaydedin veya harici kuponun sonucunu ekleyin.</p>';
    return;
  }
  target.innerHTML = records.map((record) => {
    const pool = getPoolLabel(record.poolType);
    const date = escapeHtml(record.date || "Tarih yok");
    const venue = record.city ? ` · ${escapeHtml(record.city)}` : "";
    const ticket = record.columns ? `${record.columns} kolon · ${money(record.cost)}` : `Maliyet ${money(record.cost)} · seçim dökümü yok`;
    const paid = Number.isFinite(Number(record.payout)) && record.status !== "pending" ? money(record.payout) : "bekleniyor";
    const netValue = Number(record.payout) - Number(record.cost);
    const netText = record.status !== "pending" ? `<p>Net: <span class="coupon-net${netValue < 0 ? " negative" : ""}">${money(netValue)}</span></p>` : "";
    const legs = Array.isArray(record.legs) && record.legs.length ? `<p>Seçimler: ${record.legs.map((leg) => `${leg.raceNo}. ayak #${leg.horses.map((horse) => horse.number).join(", #")}`).join(" · ")}</p>` : "";
    const legEvaluation = window.CouponResults.evaluateCouponLegs(record.legs, record.legResults);
    const legSummary = legEvaluation.total ? `<p class="coupon-leg-summary">${legEvaluation.completed === legEvaluation.total ? `${legEvaluation.hits}/${legEvaluation.total} ayak tuttu` : `${legEvaluation.hits} isabet · ${legEvaluation.completed}/${legEvaluation.total} ayak sonucu girildi`}${legEvaluation.missedRaceNos.length ? ` · kaçan ayak: ${legEvaluation.missedRaceNos.join(", ")}` : ""}</p>` : "";
    const legLearningReport = (record.legResults || []).map((result) => {
      const prediction = findSavedPrediction(record.date, record.city, result.raceNo);
      const selected = record.legs?.find((leg) => Number(leg.raceNo) === Number(result.raceNo))?.horses?.map((horse) => horse.number) || [];
      const insight = window.CouponLearning.analyzePredictionResult(prediction, result.winnerNumber, selected);
      const categoryLabel = { "kupon-isabeti": "kupon isabeti", "model-top3-kupon-dışı": "model ilk 3\u2019te, kupona alınmamış", "model-sıralaması-geride": "model sıralaması geride", "tahmin-eşleşmedi": "kayıtlı tahmin eşleşmedi" }[insight.category];
      const context = insight.matched ? ` · ${escapeHtml(insight.surface)} / ${escapeHtml(insight.type)}${insight.distance ? ` / ${insight.distance} m` : ""}` : "";
      return `<p class="coupon-leg-learning">${Number(result.raceNo)}. ayak · kazanan #${Number(result.winnerNumber)} · ${insight.winnerRank ? `model sırası #${insight.winnerRank}` : "sıra yok"} · ${categoryLabel}${context}</p>`;
    }).join("");
    const existingLegResults = new Map((record.legResults || []).map((result) => [Number(result.raceNo), result.winnerNumber]));
    const legResultEditor = legEvaluation.total ? `<fieldset class="leg-result-grid"><legend class="sr-only">Her ayaktaki gerçek kazanan at numarası</legend>${record.legs.map((leg) => `<label>${leg.raceNo}. ayak kazananı<input data-leg-result="${Number(leg.raceNo)}" type="number" min="1" step="1" value="${existingLegResults.get(Number(leg.raceNo)) ?? ""}" aria-label="${Number(leg.raceNo)}. ayak kazanan at numarası"></label>`).join("")}</fieldset>` : "";
    const finished = Array.isArray(record.finishedNos) && record.finishedNos.length ? `<p>Sonucu alınmış ayaklar: ${record.finishedNos.join(", ")}. Kupon anlık olarak açık ayaklar üzerinden oluşturulmuş; önceki kuponun geriye dönük kopyası değildir.</p>` : "";
    return `<article class="coupon-record" data-coupon-card="${escapeHtml(record.id)}"><h3>${pool} · ${date}${venue}</h3><p>${escapeHtml(record.source || "Kupon")} · ${ticket}</p>${legs}${legSummary}${legLearningReport}${legResultEditor}${finished}<p>Durum: ${escapeHtml(COUPON_STATUS_LABELS[record.status] || "Sonuç bekleniyor")} · Ödeme: ${paid}</p>${netText}<div class="controls"><label class="control"><small>Sonuç durumu</small><select data-coupon-status aria-label="${pool} ${date} sonuç durumu">${Object.entries(COUPON_STATUS_LABELS).map(([value, label]) => `<option value="${value}"${record.status === value ? " selected" : ""}>${label}</option>`).join("")}</select></label><label class="control"><small>Alınan ödeme (TL)</small><input data-coupon-payout type="number" min="0" step="0.01" value="${record.payout ?? ""}" placeholder="Sonuç bekleniyorsa boş bırakın" aria-label="${pool} ${date} alınan ödeme"></label><button class="btn secondary" type="button" data-update-coupon="${escapeHtml(record.id)}">Sonucu kaydet</button></div></article>`;
  }).join("");
}
function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `yaris-analiz-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
function importBackup(file) {
  if (!file || !window.confirm("Bu yedek mevcut tarayıcıdaki analiz geçmişinin üzerine yazılsın mı?")) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result || ""));
      if (!imported || typeof imported !== "object" || !Array.isArray(imported.outcomes) || !Array.isArray(imported.predictions) || !imported.profiles || typeof imported.profiles !== "object") throw new Error("Yedek dosyasının biçimi geçersiz.");
      state = { ...DEFAULT_STATE, ...imported, profiles: { ...DEFAULT_PROFILES, ...imported.profiles }, modelWeights: { ...BASE_WEIGHTS, ...(imported.modelWeights || {}) } };
      lastAnalysis = state.predictions;
      saveState();
      showMessage($("ogrenmeLogAlani"), "Yedek bu tarayıcıya aktarıldı.", "success");
    } catch (error) {
      showMessage($("ogrenmeLogAlani"), error.message || "Yedek dosyası okunamadı.", "error");
    }
  };
  reader.readAsText(file);
}
function updateMemory() {
  const n = state.outcomes.length;
  const top3 = state.outcomes.filter((item) => item.top3Hit).length;
  const top1 = state.outcomes.filter((item) => item.top1Hit).length;
  const trainable = state.outcomes.filter((item) => Array.isArray(item.horses) && item.horses.length > 1).length;
  const singleResults = state.outcomes.filter((item) => item.singleCandidate);
  const singleHits = singleResults.filter((item) => item.singleHit).length;
  const contextCount = Object.keys(state.contextWeights || {}).length;
  const report = state.trainingReport;
  $("modelBadge").textContent = `Uyarlamalı model · v${state.version}`;
  $("statsArea").innerHTML = n
    ? `<div class="stats"><div class="stat"><b>${n}</b><span>ölçülen koşu</span></div><div class="stat"><b>%${Math.round(top3 / n * 100)}</b><span>ilk 3 içi isabet oranı</span></div><div class="stat"><b>%${Math.round(top1 / n * 100)}</b><span>model lideri isabeti</span></div></div><div class="meter" aria-label="İlk üç isabet oranı"><span style="width:${Math.round(top3 / n * 100)}%"></span></div><p class="hint">Kişisel karşılaştırmalar (girişte Firebase hesabıyla eşitlenir) ve Neon resmi yarış arşivi birlikte değerlendirilir. ${trainable < MODEL_MIN_RACES ? `Ağırlık kalibrasyonu için ${MODEL_MIN_RACES} uygun yarış gerekir; şu an ${trainable} var.` : !report?.validatedAt ? "En az 5 ayrı tarihli eğitim/doğrulama ayrımı henüz oluşmadı; başlangıç ağırlıkları kullanılıyor." : report.updated ? `Ağırlıklar zamana göre ayrılmış doğrulama diliminde iyileşti (Brier ${report.baselineBrier.toFixed(3)} → ${report.validationBrier.toFixed(3)}; doğrulama ${report.validationRaces} koşu).` : "Ayrılmış tarih doğrulamasında en az %2 iyileşme görülmedi; başlangıç ağırlıkları korundu."} Tek seçim eşiği geçmişi: ${singleHits}/${singleResults.length}${singleResults.length < 30 ? " (örnek yetersiz: 30’dan az aday)" : ""}; doğrulanmış pist/koşu türü ağırlığı: ${contextCount}. Yüzdeler geçmiş isabet ölçümüdür, gelecekte kazanma olasılığı değildir.</p>`
    : `<p class="muted">Henüz ölçülmüş sonuç yok. Yüzde hesaplamak için tahminleri gerçek sonuçlarla karşılaştırın.</p>`;
  const profileNames = Object.keys(state.profiles).sort();
  $("aygirListeAlani").textContent = `${profileNames.length} pedigri profili: ${profileNames.slice(0, 12).join(", ")}${profileNames.length > 12 ? "…" : ""}`;
  $("historyArea").innerHTML = n ? `<table class="table"><thead><tr><th>Hipodrom / koşu</th><th>Kazanan</th><th>İlk üç</th><th>Lider</th><th>Tarih</th></tr></thead><tbody>${state.outcomes.slice(-30).reverse().map((item) => `<tr><td>${escapeHtml(item.city || "Manuel")} · ${item.raceNo}</td><td>#${item.winner} ${escapeHtml(item.winnerName)}</td><td>${item.top3Hit ? "Evet" : "Hayır"}</td><td>${item.top1Hit ? "Evet" : "Hayır"}</td><td>${new Date(item.at).toLocaleDateString("tr-TR")}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Karşılaştırma geçmişi henüz yok.</p>`;
  renderCouponHistory();
}
function addProfile() {
  const name = normalize($("aygirAdInput").value).replace(/[^A-Z0-9]/g, "");
  const values = $("dpValues")
    ? $("dpValues").value.split(/[;,\s]+/).filter(Boolean).map(parseNumber)
    : ["dpB", "dpI", "dpC", "dpS", "dpP"].map((id) => parseNumber($(id)?.value ?? "0"));
  if (!name || values.length !== 5 || values.some((value) => value === null || value < 0)) { showMessage($("aygirListeAlani"), "Aygır adı ve sıfır veya daha büyük 5 sayısal profil değeri girin. Örnek: 6, 6, 4, 0, 0", "error"); return; }
  state.profiles[name] = values;
  saveState();
  $("aygirAdInput").value = "";
  if ($("dpValues")) $("dpValues").value = "";
  else ["dpB", "dpI", "dpC", "dpS", "dpP"].forEach((id) => { if ($(id)) $(id).value = ""; });
  showMessage($("aygirListeAlani"), `${name} profili kaydedildi.`, "success");
}
function resetHistory() {
  const scope = firebaseAccount ? "Bu cihazdaki ve Firebase hesabınızdaki" : "Bu tarayıcıdaki";
  if (!window.confirm(`${scope} yarış sonuçları, kupon sonuç kayıtları ve eklenen profiller silinsin mi?`)) return;
  state = { ...DEFAULT_STATE, profiles: { ...DEFAULT_PROFILES }, coupons: [] };
  lastAnalysis = [];
  lastCoupons = {};
  saveState();
  $("ogrenmeLogAlani").innerHTML = "";
  showMessage($("ogrenmeLogAlani"), "Öğrenme geçmişi varsayılanlara döndürüldü.", "success");
}
document.addEventListener("DOMContentLoaded", async () => {
  state = await restoreState();
  initializeFirebaseMemory().catch(() => setFirebaseStatus("Firebase bağlantısı başlatılamadı; yerel hafıza korunuyor.", true));
  $("driveConnectButton")?.addEventListener("click", connectGoogleDrive);
  $("driveBackupButton")?.addEventListener("click", backupToGoogleDrive);
  $("driveRestoreButton")?.addEventListener("click", restoreFromGoogleDrive);
  if (new URLSearchParams(location.search).get("drive") === "connected") {
    setDriveStatus("Google Drive izni alındı; Firebase hesabınızı denetliyoruz…");
    history.replaceState({}, "", `${location.pathname}${location.hash}`);
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("installAppBtn").hidden = false;
  });
  $("installAppBtn").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt();
    deferredInstallPrompt = null;
    $("installAppBtn").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("installAppBtn").hidden = true; });
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab || button.dataset.panel)));
  const todayLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("couponDateInput").value = todayLocal;
  $("resultsDateInput").value = todayLocal;
  $("manualCouponDate").value = todayLocal;
  $("manualCouponForm")?.addEventListener("submit", addManualCoupon);
  $("couponHistoryArea")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-update-coupon]");
    if (button) updateCouponResult(button.dataset.updateCoupon, button.closest("[data-coupon-card]"));
  });
  $("kuponAlani")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-coupon]");
    if (button) saveGeneratedCoupon(button.dataset.saveCoupon);
  });
  $("analyzeBtn")?.addEventListener("click", analyze);
  $("analyzeButton")?.addEventListener("click", analyze);
  $("clearBtn")?.addEventListener("click", () => { $("hamBultenInput").value = ""; $("bultenUyariAlani").innerHTML = ""; });
  $("clearButton")?.addEventListener("click", () => { $("hamBultenInput").value = ""; $("bultenUyariAlani").innerHTML = ""; });
  $("chooseResultsImageButton")?.addEventListener("click", () => $("resultsImageInput")?.click());
  $("resultsImageInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 15 * 1024 * 1024) {
      selectedResultImage = null;
      $("readResultsImageButton").disabled = true;
      $("resultsImagePreview").hidden = true;
      setResultImageStatus("JPG, PNG veya WebP biçiminde ve 15 MB’tan küçük bir görsel seçin.", true);
      return;
    }
    selectedResultImage = file;
    const preview = $("resultsImagePreview");
    if (resultImagePreviewUrl) URL.revokeObjectURL(resultImagePreviewUrl);
    resultImagePreviewUrl = URL.createObjectURL(file);
    preview.src = resultImagePreviewUrl;
    preview.hidden = false;
    $("readResultsImageButton").disabled = false;
    setResultImageStatus(`${file.name} seçildi. Metni okumak için düğmeye basın.`);
  });
  $("readResultsImageButton")?.addEventListener("click", extractResultsFromImage);
  $("learnBtn")?.addEventListener("click", handleCompareResults);
  $("learnButton")?.addEventListener("click", handleCompareResults);
  $("saveHorseBtn")?.addEventListener("click", addProfile);
  $("saveSireButton")?.addEventListener("click", addProfile);
  $("exportBackupBtn").addEventListener("click", exportBackup);
  $("refreshArchiveBtn")?.addEventListener("click", syncHistoricalArchive);
  $("importBackupInput").addEventListener("change", (event) => {
    importBackup(event.target.files?.[0]);
    event.target.value = "";
  });
  $("resetBtn")?.addEventListener("click", resetHistory);
  $("resetButton")?.addEventListener("click", resetHistory);
  document.querySelectorAll(".tab").forEach((button, index, buttons) => button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); buttons[next].click();
  }));
  if (state.predictions?.length) lastAnalysis = state.predictions;
  updateMemory();
  renderTrainingReport();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  syncHistoricalArchive();
});
