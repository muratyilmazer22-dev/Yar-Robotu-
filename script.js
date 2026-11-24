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
  const archiveWindowStart = new Date(today);
  archiveWindowStart.setDate(archiveWindowStart.getDate() - 365);
  const toIsoDate = (date) => {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 10);
  };
  const earliestDate = toIsoDate(archiveWindowStart);
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
      const auditedCount = Number(data.qualitySummary?.auditedCount || 0);
      const needsReview = Number(data.qualitySummary?.needsReview || 0);
      summary.replaceChildren(
        renderMetric('Neon kayıtlı koşu', Number(data.raceCount || 0).toLocaleString('tr-TR')),
        renderMetric('İlk kayıt', data.firstDate || '—'),
        renderMetric('Son kayıt', data.lastDate || '—'),
        renderMetric('Arşiv kalite kayıtları', auditedCount ? `${needsReview} inceleme / ${auditedCount} denetim` : 'Henüz denetim yok')
      );
      setStatus(Number(data.raceCount || 0) && data.lastDate ? `TJK arşivindeki son kayıt: ${data.lastDate}. Son içe aktarma kalite bilgisi kalıcı denetim kaydında tutulur.` : 'Neon arşivi boş; TJK’den tarih aralığı seçerek içe aktarın.');
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
    if (!dates.length || dates.length > 366) {
      setStatus('Başlangıç ve bitiş tarihlerini kontrol edin; aralık bir yılı aşamaz.', true);
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
        renderMetric('Sabit model ROI', data.returnMetrics?.fixed?.roi == null ? 'Ölçülemedi' : `${data.returnMetrics.fixed.roi}%`),
        renderMetric('Piyasa favorisi ROI', data.returnMetrics?.favorite?.roi == null ? 'Ölçülemedi' : `${data.returnMetrics.favorite.roi}%`),
        renderMetric('Öğrenilmiş model ROI', data.returnMetrics?.automatic?.roi == null ? 'Ölçülemedi' : `${data.returnMetrics.automatic.roi}%`),
        renderMetric('ROI fiyatı olan koşu', `${data.returnMetrics?.fixed?.pricedRaces || 0} / ${data.returnMetrics?.fixed?.races || 0}`),
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
      const automaticValidation = data.automaticModelValidation || {};
      const holdout = automaticValidation.finalHoldout;
      const formatHoldout = (metric) => metric
        ? `isabet %${metric.hitRate == null ? '—' : (metric.hitRate * 100).toFixed(1)} · ROI ${metric.roi == null ? 'ölçülemedi' : `${metric.roi.toFixed(1)}%`} (${metric.pricedRaces || 0} oranlı koşu)`
        : 'ölçülemedi';
      const automaticValidationBlock = document.createElement('section');
      const automaticValidationTitle = document.createElement('h3');
      automaticValidationTitle.textContent = 'Doğrulanmış otomatik model — ileri tarih karşılaştırması';
      const automaticValidationNote = document.createElement('p');
      automaticValidationNote.className = 'sub';
      automaticValidationNote.textContent = automaticValidation.available
        ? `${automaticValidation.from} – ${automaticValidation.to || '—'} arasında ${Number(automaticValidation.races || 0).toLocaleString('tr-TR')} koşu. Otomatik model lider isabeti: ${automaticValidation.modelTop1HitRate ?? '—'}%; piyasa favorisi: ${automaticValidation.marketFavoriteHitRate ?? '—'}%. Aynı koşulardaki Brier skoru: temel ${automaticValidation.baselineBrier?.toFixed(3) ?? '—'}, öğrenilmiş ${automaticValidation.learnedBrier?.toFixed(3) ?? '—'}; düşük değer daha iyi olasılık kalibrasyonu demektir. Eğitim raporu: ${automaticValidation.trainingReport?.trainingRaces ?? '—'} eğitim / ${automaticValidation.trainingReport?.validationRaces ?? '—'} doğrulama koşusu, ${automaticValidation.contextModelCount || 0} bağlam modeli. Bu doğrulama dilimi model ağırlıklarının eğitiminde kullanılmadı. Bağımsız son holdout (${automaticValidation.holdoutFrom || '—'} – ${automaticValidation.holdoutTo || '—'}): öğrenilmiş ${formatHoldout(holdout?.learned)}, sabit ${formatHoldout(holdout?.fixed)}, piyasa favorisi ${formatHoldout(holdout?.favorite)}.`
        : automaticValidation.reason || 'Henüz ileri tarih diliminde doğrulanmış otomatik model bulunmuyor.';
      automaticValidationBlock.append(automaticValidationTitle, automaticValidationNote);
      const note = document.createElement('p');
      note.className = 'sub';
      note.textContent = `Tek günlük veya küçük örnek sonuçları genellemez. Kaydedilmiş ${Number(data.storedRaces || 0).toLocaleString('tr-TR')} koşudan ${Number(data.omittedRaces || 0).toLocaleString('tr-TR')} tanesi gerekli program/sonuç eşleşmesi olmadığı için test dışı kaldı. Ana metrikler sabit başlangıç modeline aittir; doğrulanmış otomatik model, ağırlıkların eğitiminde kullanılmamış ayrı tarih diliminde yukarıda ayrıca karşılaştırılır. ${data.method} ${data.returnMetrics?.basis || ''}`;
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
      backtestSummary.replaceChildren(metrics, validationBlock, automaticValidationBlock, note, rankBreakdown, breakdown);
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
  const MODEL_VERSION = "single-weighted-v2-lineage-rivals";
  const PERSONAL_LEARNING_SOURCE = "user-bulletins-v1";
  const MODEL_MIN_RACES = 30;
const TRAINING_WINDOW_RACES = 2000;
const SINGLE_GAP_THRESHOLD = 12.5;
const MIN_SINGLE_COVERAGE = 50;
let scoreCache = new WeakMap();
let classHistoryArchive = new Map();
let raceRelationArchive = new Map();
let raceContextArchive = new Map();
let pedigreeHistoryArchive = new Map();
const DEFAULT_STATE = { version: 3, profiles: {}, predictions: [], outcomes: [], coupons: [], bulletins: [], modelWeights: { ...BASE_WEIGHTS }, lastGoodModelWeights: { ...BASE_WEIGHTS }, modelWeightVersions: [], contextWeights: {} };
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
  const hasPersonalLearningState = saved?.learningSource === PERSONAL_LEARNING_SOURCE;
  const modelWeights = { ...BASE_WEIGHTS, ...(hasPersonalLearningState ? saved?.modelWeights || {} : {}) };
  const hasWeightHistory = hasPersonalLearningState && Array.isArray(saved?.modelWeightVersions) && saved.modelWeightVersions.length > 0;
  const modelWeightVersions = hasWeightHistory ? saved.modelWeightVersions.slice(-20) : [];
  return {
    ...DEFAULT_STATE,
    ...(saved && typeof saved === "object" ? saved : {}),
    version: 3,
    profiles: { ...DEFAULT_PROFILES },
    predictions: Array.isArray(saved?.predictions) ? saved.predictions : [],
    outcomes: Array.isArray(saved?.outcomes) ? saved.outcomes : [],
  coupons: Array.isArray(saved?.coupons) ? saved.coupons : [],
  bulletins: Array.isArray(saved?.bulletins) ? saved.bulletins : [],
    modelWeights,
    learningSource: PERSONAL_LEARNING_SOURCE,
    trainingReport: hasPersonalLearningState ? saved?.trainingReport || null : null,
    lastGoodModelWeights: hasPersonalLearningState ? { ...BASE_WEIGHTS, ...(saved?.lastGoodModelWeights || saved?.modelWeights || {}) } : { ...BASE_WEIGHTS },
    modelWeightVersions,
    contextWeights: hasPersonalLearningState && saved?.contextWeights && typeof saved.contextWeights === "object" ? saved.contextWeights : {}
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
let sharedAutomaticModel = null;
function sharedModelReportText() {
  const model = sharedAutomaticModel;
  if (!model) return "Ortak otomatik model raporu henüz alınmadı.";
  const report = model.report || {};
  const validation = model.lastAcceptedValidation;
  const status = validation
    ? `resmi TJK verisinden doğrulanmış ortak model (${validation.from}–${validation.to || "—"}; kişisel tahmin ağırlıklarına uygulanmaz)`
    : "henüz kabul edilmiş ileri-tarih doğrulaması yok; ortak model yalnızca ayrı raporlanır";
  const scores = typeof report.baselineBrier === "number" && Number.isFinite(report.baselineBrier)
    && typeof report.validationBrier === "number" && Number.isFinite(report.validationBrier)
    ? `Brier temel ${report.baselineBrier.toFixed(4)} / rapor ${report.validationBrier.toFixed(4)}`
    : "Brier doğrulaması henüz yok";
  return `Ortak model: ${model.model || "model adı yok"} · ${status} · ${Number(model.trainedRaceCount || 0).toLocaleString("tr-TR")} eğitim verili koşu · ${Number(report.trainingRaces || 0)} eğitim / ${Number(report.validationRaces || 0)} doğrulama · ${scores} · ${Object.keys(model.contextWeights || {}).length} bağlam modeli · son yenileme ${model.refreshedAt || "bilinmiyor"}.`;
}
let lastAnalysis = [];
let lastCoupons = {};
let resultCompareTimer = null;
let deferredInstallPrompt = null;
let singleEvidenceCache = null;
let firebaseSdk = null;
let firebaseAccount = null;
let firebaseSyncReady = false;
  let firebaseSaveTimer = null;
  let bulletinSaveTimer = null;
  let firebaseSyncChain = Promise.resolve();
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function persistStateLocally() {
  if (stateDb) {
    return new Promise((resolve) => {
      try {
        const transaction = stateDb.transaction("app", "readwrite");
        transaction.objectStore("app").put({ id: "current", value: JSON.parse(JSON.stringify(state)) });
        transaction.oncomplete = () => resolve(true);
        transaction.onabort = transaction.onerror = () => {
          showMessage($("ogrenmeLogAlani"), "Tarayıcı hafızasına yazılamadı. Yedeği indirip saklayın.", "error");
          resolve(false);
        };
      } catch {
        showMessage($("ogrenmeLogAlani"), "Tarayıcı hafızasına erişilemiyor. Yedeği indirip saklayın.", "error");
        resolve(false);
      }
    });
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return Promise.resolve(true);
  } catch {
    showMessage($("ogrenmeLogAlani"), "Tarayıcı depolaması dolu veya kullanılamıyor. Yedeği indirip saklayın.", "error");
    return Promise.resolve(false);
  }
}
function setFirebaseStatus(message, isError = false) {
  const status = $("firebaseMemoryStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}
function mergeMemoryRecords(remoteRecords, localRecords, keyOf) {
  const merged = new Map();
  for (const item of remoteRecords || []) merged.set(keyOf(item), item);
  for (const item of localRecords || []) merged.set(keyOf(item), item);
  return [...merged.values()];
}
function predictionKey(item) {
  return window.RaceLearningEvaluation.predictionIdentity(item);
}
function mergePredictionHistory(existing, incoming) {
  return window.RaceLearningEvaluation.mergePredictions(existing, incoming);
}
function mergeFirebaseMemory(localState, remoteState) {
  const localTime = Date.parse(localState.localUpdatedAt || "") || 0;
  const remoteTime = Date.parse(remoteState.localUpdatedAt || "") || 0;
  const latest = remoteTime > localTime ? remoteState : localState;
  return normalizeState({
    ...latest,
    predictions: mergePredictionHistory(remoteState.predictions, localState.predictions),
  outcomes: mergeMemoryRecords(remoteState.outcomes, localState.outcomes, (item) => item.sourceKey || `${String(item.at || "").slice(0, 10)}:${item.city || ""}:${item.raceNo}:${item.winner}`),
  coupons: mergeMemoryRecords(remoteState.coupons, localState.coupons, (item) => item.id || JSON.stringify(item)),
  bulletins: mergeMemoryRecords(remoteState.bulletins, localState.bulletins, (item) => item.id || JSON.stringify(item))
  });
}
function queueFirebaseMemorySync(immediate = false) {
  if (!firebaseAccount || !firebaseSyncReady || !firebaseSdk) return Promise.resolve(null);
  clearTimeout(firebaseSaveTimer);
  const account = firebaseAccount;
  const snapshot = JSON.parse(JSON.stringify(state));
  let resolveSync;
  const completion = new Promise((resolve) => { resolveSync = resolve; });
  const sync = () => {
    firebaseSyncChain = firebaseSyncChain.then(async () => {
      if (!firebaseSyncReady || firebaseAccount?.uid !== account.uid || snapshot.localUpdatedAt !== state.localUpdatedAt) return false;
      const cloudSnapshot = await prepareMemoryImagesForFirebase(snapshot, account);
      if (firebaseAccount?.uid !== account.uid || snapshot.localUpdatedAt !== state.localUpdatedAt) return false;
      state = { ...state, bulletins: cloudSnapshot.bulletins, profiles: { ...DEFAULT_PROFILES } };
      await persistStateLocally();
      await firebaseSdk.saveMemory(account, cloudSnapshot);
      setFirebaseStatus(`Hafıza Firebase ve Blob hesabınızla eşitlendi: ${account.email || account.uid}`);
      return true;
    }).catch(() => {
      setFirebaseStatus("Firebase eşitlemesi başarısız. Yerel kayıtlar korunuyor; Firestore kurallarını ve bağlantıyı kontrol edin.", true);
      return false;
    });
    firebaseSyncChain.then(resolveSync);
  };
  if (immediate) sync();
  else firebaseSaveTimer = window.setTimeout(sync, 900);
  return completion;
}
async function initializeFirebaseMemory() {
  const api = await window.RaceRobotFirebaseReady;
  if (!api?.ok) {
    setFirebaseStatus("Firebase yapılandırmasına şu an ulaşılamıyor. Yerel hafıza çalışmaya devam ediyor.", true);
    return;
  }
  firebaseSdk = api;
  const authForm = $("firebaseAuthForm");
  const emailInput = $("firebaseEmail");
  const submitButton = authForm?.querySelector('button[type="submit"]');
  const emailLinkInUrl = api.isEmailSignInLink(window.location.href);
  const savedEmail = window.sessionStorage.getItem("firebaseEmailForSignIn") || "";
  if (savedEmail) emailInput.value = savedEmail;
  if (emailLinkInUrl) submitButton.textContent = "Giriş bağlantısını doğrula";
  authForm?.querySelectorAll("input, button").forEach((element) => { element.disabled = false; });
  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    try {
      if (api.isEmailSignInLink(window.location.href)) {
        await api.completeEmailSignIn(email, window.location.href);
        window.sessionStorage.removeItem("firebaseEmailForSignIn");
        window.history.replaceState({}, document.title, window.location.pathname);
        setFirebaseStatus("Giriş başarılı; hafızanız otomatik eşitleniyor…");
      } else {
        await api.sendEmailSignInLink(email, `${window.location.origin}${window.location.pathname}`);
        window.sessionStorage.setItem("firebaseEmailForSignIn", email);
        setFirebaseStatus("E-posta kutunuzu kontrol edin. Bağlantıyı açınca giriş ve eşitleme otomatik tamamlanır.");
      }
    } catch {
      setFirebaseStatus("Giriş bağlantısı gönderilemedi veya doğrulanamadı. E-postayı ve Firebase e-posta bağlantısı ayarını kontrol edin.", true);
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
    $("firebaseSignOutButton").hidden = !user;
    $("firebaseAuthForm").hidden = Boolean(user) && !(emailLinkInUrl && !savedEmail);
    if (!user) {
      if (emailLinkInUrl && !savedEmail) {
        setFirebaseStatus("Bağlantıyı açtığınız e-posta adresini girip doğrulama düğmesine basın.");
      } else if (emailLinkInUrl) {
        setFirebaseStatus("E-posta bağlantısı doğrulanıyor…");
      } else {
        setFirebaseStatus("Parola gerekmez. E-posta bağlantısıyla giriş yapınca kişisel hafızanız otomatik eşitlenir.");
      }
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
      restoreLatestPredictionTarget();
      persistStateLocally();
      updateMemory();
      firebaseSyncReady = true;
      const cloudMemory = await prepareMemoryImagesForFirebase(JSON.parse(JSON.stringify(state)), user);
      state = { ...state, bulletins: cloudMemory.bulletins, profiles: { ...DEFAULT_PROFILES } };
      persistStateLocally();
      await api.saveMemory(user, cloudMemory);
      applySavedResultDraftImage();
      setFirebaseStatus(`Hafıza Firebase ve Blob hesabınızla eşitlendi: ${user.email || user.uid}`);
    } catch {
      firebaseSyncReady = false;
      setFirebaseStatus("Firebase verisi okunamadı. Yerel kayıtlar korundu; Firestore kurallarına users/{uid} için yalnızca aynı kullanıcı erişimini ekleyin.", true);
    }
  });
  if (emailLinkInUrl && savedEmail) {
    api.completeEmailSignIn(savedEmail, window.location.href).then(() => {
      window.sessionStorage.removeItem("firebaseEmailForSignIn");
      window.history.replaceState({}, document.title, window.location.pathname);
    }).catch(() => {
      setFirebaseStatus("Bağlantı doğrulanamadı. E-posta adresinizi girip yeniden deneyin.", true);
    });
  }
}
function saveState() {
  singleEvidenceCache = null;
  state.localUpdatedAt = new Date().toISOString();
  const localSave = persistStateLocally();
  updateMemory();
  queueFirebaseMemorySync();
  return localSave;
}
function imageForMemory(image) {
  if (!image) return image;
  const { dataUrl, ...metadata } = image;
  return metadata.pathname ? metadata : image;
}
async function uploadResultImage(image, user = firebaseAccount) {
  if (!image?.dataUrl || !user || !firebaseSdk) return image;
  const idToken = await firebaseSdk.getIdToken();
  if (!idToken) throw new Error("Firebase oturumu doğrulanamadı.");
  const response = await fetch("/api/result-image", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ image: image.dataUrl })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.pathname) throw new Error(result.error || "Görsel Blob hafızasına yüklenemedi.");
  return { name: image.name || "sonuc.jpg", type: "image/jpeg", savedAt: image.savedAt || new Date().toISOString(), pathname: result.pathname };
}
async function prepareMemoryImagesForFirebase(memory, user) {
  const bulletins = [];
  for (const bulletin of memory.bulletins || []) {
    if (!bulletin.image?.dataUrl) {
      bulletins.push(bulletin);
      continue;
    }
    try {
      bulletins.push({ ...bulletin, image: await uploadResultImage(bulletin.image, user) });
    } catch {
      bulletins.push(bulletin);
    }
  }
  return { ...memory, profiles: { ...DEFAULT_PROFILES }, bulletins };
}
async function loadResultImageData(image) {
  if (image?.dataUrl) return image.dataUrl;
  if (!image?.pathname || !firebaseSdk) return "";
  const idToken = await firebaseSdk.getIdToken();
  if (!idToken) return "";
  const response = await fetch(`/api/result-image?pathname=${encodeURIComponent(image.pathname)}`, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!response.ok) throw new Error("Kaydedilmiş görsele erişilemedi.");
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Kaydedilmiş görsel okunamadı."));
    reader.readAsDataURL(blob);
  });
}
async function applySavedResultDraftImage() {
  const savedImage = state.bulletins.find((item) => item.id === "draft-result")?.image;
  if (!savedImage) return;
  try {
    const dataUrl = await loadResultImageData(savedImage);
    if (!dataUrl) return;
    storedResultImage = { ...savedImage, dataUrl };
    $("resultsImagePreview").src = dataUrl;
    $("resultsImagePreview").hidden = false;
    $("readResultsImageButton").disabled = false;
    setResultImageStatus("Kaydedilmiş fotoğraf hafızadan yüklendi; OCR’ı yeniden çalıştırabilirsiniz.");
  } catch (error) {
    setResultImageStatus(error.message || "Kaydedilmiş fotoğraf yüklenemedi.", true);
  }
}
function restoreLatestPredictionTarget() {
  const latestPrediction = state.predictions.at(-1);
  if (!latestPrediction?.date || state.bulletins.find((item) => item.id === "draft-result")?.text) return;
  const resultDraft = state.bulletins.find((item) => item.id === "draft-result");
  if (resultDraft?.date && resultDraft.date >= latestPrediction.date) return;
  $("resultsDateInput").value = latestPrediction.date;
  $("resultsCityInput").value = latestPrediction.city || "";
}
function saveBulletinDraft(kind, details = {}) {
  const id = `draft-${kind}`;
  const existing = state.bulletins.find((item) => item.id === id) || {};
  const draft = {
    ...existing,
    id,
    kind,
    status: "draft",
    text: String(details.text ?? existing.text ?? ""),
    date: String(details.date ?? existing.date ?? ""),
    city: String(details.city ?? existing.city ?? ""),
    budget: String(details.budget ?? existing.budget ?? $("butceInput")?.value ?? ""),
    unit: String(details.unit ?? existing.unit ?? $("birimInput")?.value ?? ""),
    updatedAt: new Date().toISOString(),
    ...(details.image ? { image: imageForMemory(details.image) } : existing.image ? { image: imageForMemory(existing.image) } : {})
  };
  state.bulletins = [...state.bulletins.filter((item) => item.id !== id), draft];
  clearTimeout(bulletinSaveTimer);
  bulletinSaveTimer = window.setTimeout(saveState, 250);
  return draft;
}
function archiveBulletin(kind, details = {}) {
  const draftId = `draft-${kind}`;
  const draft = state.bulletins.find((item) => item.id === draftId);
  const resultDate = String(details.date ?? draft?.date ?? "");
  const resultCity = normalize(details.city ?? draft?.city ?? "").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "unspecified";
  const recordId = kind === "result" && resultDate
    ? `result-${resultDate}-${resultCity}`
    : window.crypto?.randomUUID?.() || `bulletin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const previousRecord = state.bulletins.find((item) => item.id === recordId);
  const record = {
    ...(previousRecord || {}),
    ...(draft || {}),
    ...details,
    ...(details.image ? { image: imageForMemory(details.image) } : {}),
    id: recordId,
    kind,
    status: "saved",
    savedAt: new Date().toISOString()
  };
  state.bulletins = [...state.bulletins.filter((item) => item.id !== draftId && item.id !== recordId), record];
  clearTimeout(bulletinSaveTimer);
  saveState();
  return record;
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
  const key = normalize(name).replace(/[^A-Z0-9]/g, "");
  const profile = state.profiles[key] || window.RaceScoring.DEFAULT_DNA?.[key];
  const values = Array.isArray(profile)
    ? profile.map(Number)
    : profile && typeof profile === "object"
      ? [profile.B, profile.I, profile.C, profile.S, profile.P].map(Number)
      : [];
  if (!values.length) return null;
  const [speed, intermediate, classic, stamina, staminaPlus] = values;
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
    city: race.city || $("couponCityInput")?.value.trim() || "",
    horses: race.horses.map((horse) => ({
      ...horse,
      ...window.RaceContextPerformance.scoreForHorse(raceContextArchive, horse.name, {
        city: race.city || $("couponCityInput")?.value.trim() || "",
        weather: race.weather,
        surface: race.surface,
        trackCondition: race.trackCondition,
        surfaceChange: race.surfaceChange,
        distance: race.distance,
        jockey: horse.jockey,
        weight: horse.weight
      }, raceDate),
      classHistoryScore: window.RaceClassHistory.scoreForHorse(classHistoryArchive, horse.name, raceClass, raceDate),
      groupFit: window.RaceClassHistory.groupFitForHorse(classHistoryArchive, horse.name, raceDate),
      pedigreeFit: window.RacePedigreeHistory.scoreForHorse(pedigreeHistoryArchive, horse, { surface: race.surface, distance: race.distance }, raceDate),
      rivalFit: window.RaceRelations.scoreAgainstField(race, horse, raceRelationArchive, raceDate)
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
function getRequiredSingleGap(leader) {
  const coverage = Math.max(0, Math.min(100, Number(leader?.independentCoverage) || 0));
  return SINGLE_GAP_THRESHOLD + (100 - coverage) * 0.05;
}
function isValidatedSingle(ranked) {
  if (ranked.length === 1) return true;
  if (ranked.length < 2 || ranked[0]?.isCoupled) return false;
  const gap = ranked[0].score - ranked[1].score;
  return gap >= getRequiredSingleGap(ranked[0]) && ranked[0].independentCoverage >= MIN_SINGLE_COVERAGE && singleSelectionEvidence().validated;
}
async function analyzeRaces(races) {
  const results = [];
  for (const race of races) {
    results.push(scoreRace(race));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return results;
}
function historicalEvidenceMarkup(race, horse) {
  const insight = window.RaceRelations.horseInsights(race, horse, raceRelationArchive, race.date || $("couponDateInput")?.value);
  const jockey = insight.jockey;
  const jockeyText = !jockey.available
    ? "Jokey eşleşmesi: bültende jokey verisi yok."
    : jockey.starts
      ? `${escapeHtml(horse.jockey)} ile geçmişte ${jockey.starts} start · ${jockey.wins} birincilik · ${jockey.topThree} ilk üç`
      : `${escapeHtml(horse.jockey)} ile arşivde önceki eşleşme bulunamadı`;
  const rivalText = insight.headToHead
    ? `${escapeHtml(insight.headToHead.name)} ile ${insight.headToHead.meetings} önceki karşılaşma · bu at ${insight.headToHead.ahead} kez önde bitirdi`
    : "Mevcut rakiplerle ortak sonuç kaydı bulunamadı";
  const riderContextText = horse.jockeyStarts
    ? `Bu pist/mesafe çevresinde jokey ${horse.jockeyStarts} start · ${horse.jockeyWins} birincilik · ${horse.jockeyTopThree} ilk üç`
    : "Bu pist/mesafe çevresinde jokey geçmişi bulunamadı";
  const rivalScoreText = horse.features?.rivalFit === null || horse.features?.rivalFit === undefined
    ? "Bu rakiplere karşı karşılaştırılabilir geçmiş yok"
    : `Mevcut rakiplere karşı geçmiş puanı ${Number(horse.features.rivalFit).toFixed(1)}`;
  return `<small class="horse-meta historical-evidence">Geçmiş veri: ${jockeyText}. ${riderContextText}. ${rivalText}. ${rivalScoreText}. Jokey/at ortak geçmişi bilgilendirme amaçlıdır; veri puana yalnızca eşleşen jokey ve rakip sinyalleri üzerinden girer.</small>`;
}
function renderAnalysis(races, targetId = "kosuSonucAlani") {
  const target = $(targetId);
  target.innerHTML = races.map((race) => {
    const contextLabels = [race.weather && `Hava: ${race.weather}`, race.trackCondition && `Pist: ${race.trackCondition}`, race.surfaceChange && `Pist değişikliği: ${race.surfaceChange}`].filter(Boolean).map(escapeHtml).join(" · ");
    const heading = `<h3>${race.no}. Koşu${race.time ? ` · ${escapeHtml(race.time)}` : ""} · ${escapeHtml(race.distance)} m ${escapeHtml(race.surface)} <span class="muted">· ${escapeHtml(race.type)}${contextLabels ? ` · ${contextLabels}` : ""}</span></h3>`;
    const signalLabels = { banko: "Banko", favorite: "Favorim", rival: "Rakip", surprise: "Sürpriz" };
    const signalBadges = Object.entries(race.externalSignals || {}).map(([key, numbers]) => `<span class="signal-badge">${signalLabels[key]} #${numbers.join(", #")}</span>`).join(" ");
    const signalNote = signalBadges ? `<p class="external-signals"><strong>Harici yorum:</strong> ${signalBadges}</p>` : "";
    if (race.finished) return `<article class="race">${heading}${signalNote}<p class="alert">Koşuldu · sonuç verisi bulundu. Bu ayak için tahmin gösterilmiyor.</p></article>`;
    const ranked = window.RaceEkuri.selectionUnits(scoreRace(race));
    const leaderGap = ranked.length > 1 ? Number((ranked[0].score - ranked[1].score).toFixed(1)) : 0;
    const evidence = singleSelectionEvidence();
    const singleEligible = isValidatedSingle(ranked);
    const evidenceDetail = evidence.candidates < 30
      ? `doğrulamada ${evidence.candidates}/30 aday`
      : `aday isabeti %${(evidence.hitRate * 100).toFixed(1)} · genel lider isabeti %${(evidence.baselineHitRate * 100).toFixed(1)}`;
    const requiredGap = getRequiredSingleGap(ranked[0]);
    const singleNote = ranked.length > 1
      ? `Lider farkı ${leaderGap} puan · bağımsız veri kapsamı %${ranked[0].independentCoverage} · bu koşuda tek seçim için gereken fark ${requiredGap.toFixed(1)} puan (12,5 başlangıç eşiği, veri kapsamına göre ayarlanır); ayrıca %${MIN_SINGLE_COVERAGE} kapsam ve doğrulamada genel liderden iyi sonuç gerekir (${evidenceDetail}). ${singleEligible ? "Tek seçim doğrulama ölçütlerini geçti." : "Tek seçim doğrulama ölçütlerini geçmedi."} Puan farkı olasılık değildir.`
      : "Tek koşabilir at var; bu bir tahmin üstünlüğü anlamına gelmez.";
    const repeatedJockeyCount = window.RaceRelations.repeatedJockeysAcrossLegs(races);
    const ekuriCounts = new Map();
    for (const horse of race.horses) {
      const group = window.RaceEkuri.normalizeGroup(horse.couplingGroup);
      if (group) ekuriCounts.set(group, (ekuriCounts.get(group) || 0) + 1);
    }
    const ekuriPairCount = [...ekuriCounts.values()].filter((count) => count > 1).length;
    const relationshipNote = `<p class="hint historical-summary">Atın geçmiş hipodrom, hava ve pist koşullarındaki sonuçları yeterli eşleşme varsa puana katılır; jokeyin aynı pist/mesafe performansı ile mevcut rakiplere karşı önceki bitirişleri de puanlanır. Eşleşmeyen bağlam puanı etkilemez. ${repeatedJockeyCount ? `${repeatedJockeyCount} jokey birden fazla ayakta görünüyor.` : "Ayaklar arasında tekrarlanan jokey tespit edilmedi."} Eküri yalnızca bültendeki açık eküri kodu aynı olan atlarda uygulanır; ${ekuriPairCount ? `${ekuriPairCount} eküri grubu bulundu.` : "bu bültende açık eküri kodu bulunmadı."} KGS (koşmadığı gün sayısı), son starttan bu yana geçen süreyi gösterir; uzun ara ve kısa dinlenme olasılıklarını form ile birlikte değerlendirmeye yardımcı olur. Tek başına performans kanıtı değildir ve veri yoksa tahmin edilmez. Sistem at sahibi benzerliğinden eşleşme tahmin etmez.</p>`;
    const metricTable = ranked.length ? `<details class="analysis-details"><summary>Detaylı analiz tablosu</summary><p class="hint">Puanlar göreli sıralamadır, kazanma olasılığı değildir. Grup gücü; önceki yarışın sınıfı, rakiplerin medyan HP&apos;si ve atın bitirişini birlikte değerlendirir. Pedigri puanı, aynı pist türü ve mesafe bandındaki önceki yavru sonuçlarından öğrenilir; en az üç farklı yavru yoksa gösterilmez. Derece uyumu aynı pist türü ve 200 m yakınlıktaki geçmiş dereceleri karşılaştırır.</p><div class="analysis-table-wrap" role="region" aria-label="Atların detaylı analiz tablosu" tabindex="0"><table class="analysis-table"><thead><tr><th scope="col">Sıra</th><th scope="col">At no</th><th scope="col">At adı</th><th scope="col">Genel</th><th scope="col">Form</th><th scope="col">Piyasa</th><th scope="col">Pedigri</th><th scope="col">Rakip geçmişi</th><th scope="col">Jokey</th><th scope="col">Mesafe</th><th scope="col">Kilo</th><th scope="col">Grup gücü</th><th scope="col">Derece uyumu</th><th scope="col">HP</th><th scope="col">AGF</th><th scope="col">Oran</th><th scope="col">Son 6</th></tr></thead><tbody>${ranked.map((horse, index) => `<tr${index === 0 ? ' class="leader-row"' : ""}><td>${index + 1}</td><td>${Number.isSafeInteger(horse.number) && horse.number > 0 ? horse.number : "—"}</td><td>${escapeHtml(horse.name)}</td><td>${horse.score.toFixed(1)}</td><td>${horse.features.form === null ? "—" : horse.features.form.toFixed(1)}</td><td>${horse.features.market === null ? "—" : horse.features.market.toFixed(1)}</td><td>${horse.features.pedigree === null ? "—" : `${horse.features.pedigree.toFixed(1)} · ${escapeHtml(horse.pedigreeSource || "kaynak yok")}`}</td><td>${horse.features.rivalFit === null ? "—" : horse.features.rivalFit.toFixed(1)}</td><td>${horse.features.jockeyFit === null ? "—" : horse.features.jockeyFit.toFixed(1)}</td><td>${horse.features.distanceFit === null ? "—" : horse.features.distanceFit.toFixed(1)}</td><td>${horse.features.weightFit === null ? "—" : horse.features.weightFit.toFixed(1)}</td><td>${horse.features.groupFit === null ? "—" : horse.features.groupFit.toFixed(1)}</td><td>${horse.features.timeFit === null ? "—" : horse.features.timeFit.toFixed(1)}</td><td>${horse.hp === null ? "—" : horse.hp}</td><td>${horse.agf === null ? "—" : `%${horse.agf}`}</td><td>${horse.odds === null ? "—" : horse.odds}</td><td>${horse.last6 || "—"}</td></tr>`).join("")}</tbody></table></div></details>` : "";
    return `<article class="race">${heading}${signalNote}<p class="hint">${singleNote}</p>${relationshipNote}${ranked.length ? ranked.map((horse, index) => `<div class="horse"><strong class="horse-number"><small>AT NO</small>${Number.isSafeInteger(horse.number) && horse.number > 0 ? horse.number : "—"}</strong><span class="horse-info"><strong>${escapeHtml(horse.name || "İsimsiz at")}</strong>${index === 0 ? " <small class=\"leader-label\">Lider</small>" : ""}${horse.isCoupled ? `<small>Eküri · ${horse.members.map((member) => `#${member.number} ${escapeHtml(member.name)}`).join(" + ")}</small>` : ""}<small>${escapeHtml(horse.signal || "Sinyal yok")}</small><small>Veri güveni: ${escapeHtml(horse.confidence || "Düşük")} · kapsam %${Number(horse.coverage) || 0} · bağımsız veri %${Number(horse.independentCoverage) || 0}</small><small>Grup puanı ${horse.features.groupFit === null ? "—" : horse.features.groupFit.toFixed(1)} · Pedigri puanı ${horse.features.pedigree === null ? "—" : horse.features.pedigree.toFixed(1)}</small></span><span class="score"><small>PUAN</small>${horse.score.toFixed(1)}</span><small class="horse-meta">${horse.agf === null ? "AGF yok" : `AGF %${horse.agf}`}${horse.odds === null ? " · Oran yok" : ` · Oran ${horse.odds}`}${horse.hp === null ? " · HP yok" : ` · HP ${horse.hp}`}${Number.isFinite(horse.daysSinceLastRace) ? ` · KGS ${horse.daysSinceLastRace} gün` : " · KGS yok"}</small>${historicalEvidenceMarkup(race, horse)}</div>`).join("") : "<p class=muted>Koşabilir at bulunamadı.</p>"}${metricTable}</article>`;
  }).join("");
}
function buildCoupon(races, budget, unit) {
  if (races.length !== 6) return { error: "Altılı kupon için 6 okunabilir koşu gerekir." };
  const finishedNos = races.filter((race) => race.finished).map((race) => race.no);
  const openLegs = races.filter((race) => !race.finished).map((race) => ({ race, ranked: window.RaceEkuri.selectionUnits(scoreRace(race)) }));
  if (!openLegs.length) return { completedOnly: true, finishedNos };
  const unnumberedHorses = openLegs.flatMap(({ race }) => race.horses
    .filter((horse) => !horse.scratched)
    .filter((horse) => {
      const value = horse.horseNumber ?? horse.no;
      const number = value === null || value === undefined || value === "" ? null : Number(value);
      return !Number.isSafeInteger(number) || number <= 0;
    })
    .map((horse) => `${race.no}. koşu${horse.name ? ` (${horse.name})` : ""}`));
  if (unnumberedHorses.length) {
    const affected = [...new Set(unnumberedHorses)].slice(0, 4).join(", ");
    return { error: `Bültende at numarası okunamayan koşucular var: ${affected}. Yanlış ayak/at üretmemek için kupon oluşturulmadı; at numarası ve adı sütunlarıyla bülteni yeniden yapıştırın.` };
  }
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
    pick.excludedHorses = pick.ranked.slice(pick.count).flatMap((unit) => unit.members || [unit]);
  }
  const forcedSingleCount = picks.filter((pick) => pick.budgetForcedSingle).length;
  return { picks, columns, total: Math.round(columns * unit * 100) / 100, budget, maxColumns, budgetNarrowed: picks.some((pick) => pick.budgetNarrowed), budgetForcedSingle: forcedSingleCount > 0, budgetForcedMultipleSingles: budgetForcedMultipleSingles && forcedSingleCount > 1, forcedSingleCount, finishedNos };
}
function formatCoupon(coupon, poolTitle, poolKey) {
  if (coupon.error) return `<article class="card coupon-detail"><h3>${escapeHtml(poolTitle)}</h3><p class="coupon-intro">${escapeHtml(coupon.error)}</p></article>`;
  if (coupon.completedOnly) return `<article class="card coupon-detail"><h3>${escapeHtml(poolTitle)}</h3><p class="coupon-intro">Koşular tamamlandı; kupon oluşturulmadı.</p></article>`;

  const warning = coupon.budgetForcedMultipleSingles
    ? `<div class="alert">Bütçe nedeniyle ${coupon.forcedSingleCount} ayakta doğrulanmamış tek seçim kullanıldı.</div>`
    : coupon.budgetForcedSingle
      ? `<div class="alert">Bütçe nedeniyle bir ayakta doğrulanmamış tek seçim kullanıldı.</div>`
      : coupon.budgetNarrowed
        ? `<div class="alert">Bütçe bazı ayaklardaki at sayısını sınırladı.</div>`
        : "";
  const completed = coupon.finishedNos?.length ? `<p class="coupon-intro">Koşulan ayaklar: ${coupon.finishedNos.map((no) => `${no}. koşu`).join(", ")}</p>` : "";
  const excludedPicks = coupon.picks.filter((pick) => pick.excludedHorses.length);
  const excludedNote = excludedPicks.length
    ? `<p class="coupon-intro">Bütçe nedeniyle alınmayan seçimler: ${excludedPicks.map((pick) => `${pick.no}. koşu: ${pick.excludedHorses.map((horse) => `${Number.isSafeInteger(horse.number) && horse.number > 0 ? `#${horse.number}` : "No belirtilmemiş"} ${escapeHtml(horse.name || "İsimsiz at")}`).join(", ")}`).join(" · ")}</p>`
    : "";
  const unusedBudget = Math.max(0, coupon.budget - coupon.total);
  const legs = coupon.picks.map((pick) => {
    const labels = pick.ranked.slice(0, pick.count).flatMap((unit) => unit.members || [unit]).map((horse) => `<span class="coupon-horse">${Number.isSafeInteger(horse.number) && horse.number > 0 ? `#${horse.number}` : "No belirtilmemiş"} ${escapeHtml(horse.name)}</span>`).join("");
    return `<li class="coupon-leg"><strong>${pick.no}. Koşu</strong><div class="coupon-horses">${labels}</div></li>`;
  }).join("");
  return `<article class="card coupon-detail"><header><h3>${escapeHtml(poolTitle)}</h3><p class="coupon-intro">Model kuponu · bütçe sınırı aşılmaz</p></header>${warning}${completed}<ol class="coupon-legs">${legs}</ol>${excludedNote}<div class="coupon-total"><strong>${coupon.columns} kolon · ${coupon.total.toFixed(2)} TL</strong><span>Üst bütçe ${coupon.budget.toFixed(2)} TL · Kullanılmayan ${unusedBudget.toFixed(2)} TL</span></div><button class="btn secondary coupon-save" type="button" data-save-coupon="${poolKey}">Kuponu kaydet</button></article>`;
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
  const archivedBulletin = archiveBulletin("program", { text: input, date: $("couponDateInput")?.value || new Date().toISOString().slice(0, 10), city: $("couponCityInput")?.value.trim().slice(0, 80) || "", budget: $("butceInput")?.value || "", unit: $("birimInput")?.value || "" });
  const parsed = parseRaces(input);
  if (!parsed.races.length) {
    state.bulletins = state.bulletins.map((item) => item.id === archivedBulletin.id ? { ...item, analysisStatus: "parse-failed", analyzedAt: new Date().toISOString() } : item);
    const saved = await saveState();
    showMessage(warning, `${parsed.warnings.join(" ")}${saved ? " Bülten metni hafızaya kaydedildi; tahmin üretilemedi." : " Bülten hafızasına yazma başarısız oldu; yedeği indirin."}`, "error");
    return;
  }
  const couponDate = $("couponDateInput")?.value || new Date().toISOString().slice(0, 10);
  const couponCity = $("couponCityInput")?.value.trim().slice(0, 80) || "";
  const externalSignals = window.TipSignals.parseAnalystSignals($("analystSignalInput")?.value || "");
  parsed.races.forEach((race) => { race.externalSignals = externalSignals[race.no] || null; });
  scoreCache = new WeakMap();
  const openRaces = parsed.races.filter((race) => !race.finished);
  const results = openRaces.length ? await analyzeRaces(openRaces) : [];
  const predictionCreatedAt = new Date().toISOString();
  const runId = window.crypto?.randomUUID?.() || `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  lastAnalysis = openRaces.map((race, index) => ({
    no: race.no,
    date: couponDate,
    city: couponCity,
    runId,
    predictionCreatedAt,
    surface: race.surface,
    type: race.type,
    distance: race.distance,
    modelVersion: MODEL_VERSION,
    externalSignals: parsed.races.find((race) => race.no === openRaces[index].no)?.externalSignals || null,
    horses: results[index].map((horse) => ({ number: horse.number, name: horse.name, couplingGroup: horse.couplingGroup || "", score: horse.score, modelShare: horse.modelShare, features: horse.features, performanceScore: horse.performanceScore, marketScore: horse.marketScore, coverage: horse.coverage, independentCoverage: horse.independentCoverage, signal: horse.signal }))
  }));
  state.predictions = mergePredictionHistory(state.predictions, lastAnalysis);
  state.bulletins = state.bulletins.map((item) => item.id === archivedBulletin.id ? {
    ...item,
    analysisStatus: "complete",
    analyzedAt: new Date().toISOString(),
    analyzedRaceCount: parsed.races.length,
    predictionRaceCount: lastAnalysis.length
  } : item);
  $("resultsDateInput").value = couponDate;
  $("resultsCityInput").value = couponCity;
  saveBulletinDraft("result", { text: $("sonucluBultenInput").value, date: couponDate, city: couponCity });
  clearTimeout(bulletinSaveTimer);
  const locallySaved = await saveState();
  const cloudSaved = locallySaved && firebaseAccount && firebaseSyncReady ? await queueFirebaseMemorySync(true) : null;
  $("analysisEmptyState")?.remove();
  renderAnalysis(parsed.races);
  const completedCount = parsed.races.filter((race) => race.finished).length;
  const memoryStatus = !locallySaved
    ? "HATA: Analiz üretildi ancak tarayıcı hafızasına yazma doğrulanamadı; yedeği hemen indirin."
    : firebaseAccount && firebaseSyncReady
      ? cloudSaved
        ? "Bülten ve tahminler tarayıcıya ve Firebase hesabınıza kalıcı olarak kaydedildi."
        : "Bülten ve tahminler bu tarayıcıya kaydedildi; Firebase eşitlemesi başarısız, hesap yedeği doğrulanamadı."
      : "Bülten ve tahminler bu tarayıcının kalıcı hafızasına kaydedildi. Cihazlar arası yedek için Hesap bölümünde oturum açın.";
  const statusMessage = openRaces.length
    ? `${openRaces.length} açık koşu analiz edildi; ${completedCount} koşulmuş ayak tahmin dışında bırakıldı. ${memoryStatus}`
    : `${completedCount} koşunun tamamı koşulmuş; tahmin üretilmedi. ${memoryStatus}`;
  const persistenceFailed = !locallySaved || Boolean(firebaseAccount && firebaseSyncReady && !cloudSaved);
  if (parsed.warnings.length) showMessage(warning, `${statusMessage} ${parsed.warnings.join(" ")}`, persistenceFailed ? "error" : "");
  else showMessage(warning, `${statusMessage} Açık ayaklarda AGF/oran piyasa sinyaliyle HP/form/pedigri bağımsız performans sinyalleri ayrıştırılır.`, persistenceFailed ? "error" : "success");
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
  const personalOutcomes = state.outcomes.filter(window.RaceLearningEvaluation.isPersonalBulletinOutcome);
  const comparison = window.RaceLearningEvaluation.evaluateForwardComparison(personalOutcomes, BASE_WEIGHTS);
  if (!report.sampleSize && !comparison.validated) {
    target.textContent = `Öğrenme raporu: ${personalOutcomes.length.toLocaleString("tr-TR")} kişisel bülten sonucu · ileri tarih kıyaslaması için en az 5 ayrı yarış tarihi gerekir. ${sharedModelReportText()}`;
    return;
  }
  const currentValidation = report.validationMethod === "fixed-forward-v1";
  const modelStatus = currentValidation ? report.updated ? "Yeni ağırlıklar sabit temel modele karşı ileri tarih doğrulamasını geçti ve etkinleştirildi." : report.verified ? "Yeni ağırlıklar doğrulama eşiğini geçmedi; son iyi ağırlıklar korundu." : `Doğrulama için yeterli veri yok (en az ${MODEL_MIN_RACES} yarış).` : "Kayıtlı model eski doğrulama yöntemiyle eğitilmiş; sonraki yeni sonuçlarda sabit temel ve son iyi modelle yeniden doğrulanacak.";
  const metrics = comparison.validated ? ["learned", "favorite", "fixed"].map((key) => {
    const item = comparison.byModel[key];
    return `${key === "learned" ? "tahmin anındaki model" : key === "favorite" ? "piyasa favorisi" : "sabit temel model"}: ${item.races ? `${item.wins}/${item.races} (%${(item.hitRate * 100).toFixed(1)})` : "ölçülemedi"}`;
  }).join(" · ") : "İleri tarih karşılaştırması için henüz yeterli tarih yok.";
  const segments = comparison.byContext.filter((item) => item.eligible).map((item) => `${item.name} (${item.kind === "surface" ? "zemin" : "yarış türü"}, n=${item.races})`).join(", ");
  target.textContent = `Öğrenme raporu: ${report.sampleSize || personalOutcomes.length} uygun kişisel yarış · eğitim ${report.trainingRaces || 0} · doğrulama ${report.validationRaces || 0}${report.validationStartDate ? ` (${report.validationStartDate} sonrası)` : ""}. ${modelStatus} Brier temel: ${currentValidation && Number.isFinite(report.baselineBrier) ? report.baselineBrier.toFixed(4) : "—"} · doğrulama: ${currentValidation && Number.isFinite(report.validationBrier) ? report.validationBrier.toFixed(4) : "—"}. ${comparison.validated ? `Aynı son tarih dilimi (${comparison.startDate}–${comparison.endDate}, n=${comparison.races}): ${metrics}` : "İleri tarih kıyaslaması için beş ayrı tarihe yayılmış, yarış öncesinde kaydedilmiş sonuç bulunamadı"}. Yeterli örnekli zemin/tür: ${segments || `henüz yok (eşik ${comparison.minimumContextSample})`}. Sızıntıyı önlemek için TJK arşivinden sonradan puanlanan kayıtlar bu kıyasa dahil edilmez; yalnız yarış öncesi saklanan tahminler kullanılır. Ağırlık sürümü: ${(state.modelWeightVersions || []).at(-1)?.version || 0}. ${sharedModelReportText()}`;
}
function trainModel() {
  state.learningSource = PERSONAL_LEARNING_SOURCE;
  const eligibleOutcomes = state.outcomes.filter((item) => window.RaceLearningEvaluation.isPersonalBulletinOutcome(item) && Array.isArray(item.horses) && item.horses.length > 1 && item.horses.some((horse) => Number(horse.number) === Number(item.winner)));
  const races = window.RaceLearningEvaluation.latestOutcomePerRace(eligibleOutcomes).sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))).slice(-TRAINING_WINDOW_RACES);
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
    city: String(row.city || ""),
    weather: String(program.weather || ""),
    trackCondition: String(program.trackCondition || ""),
    surfaceChange: String(program.surfaceChange || ""),
    raceType: String(program.raceType || program.raceCategory || title),
    distance: Number(program.distance) || (distanceAndSurface ? Number(distanceAndSurface[1]) : 1400),
    surface: String(program.surface || surface),
    type,
    horses: runners.map((runner) => {
      const form = String(runner.form || "").replace(/[^1-9]/g, "").slice(0, 6);
      const hp = Number(runner.handicapPoints);
      const agf = Number(runner.agf);
      const odds = Number(runner.odds);
      return {
        number: Number(runner.horseNumber ?? runner.no),
        name: String(runner.name || ""),
        couplingGroup: String(runner.couplingGroup || ""),
        hp: Number.isFinite(hp) && hp > 0 ? hp : null,
        agf: Number.isFinite(agf) && agf > 0 ? agf : null,
        odds: Number.isFinite(odds) && odds > 0 ? odds : null,
        last6: form,
        sire: String(runner.sire || ""),
        dam: String(runner.dam || ""),
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
  sharedAutomaticModel = memory.automaticModel && typeof memory.automaticModel === "object" ? memory.automaticModel : null;
  renderTrainingReport();
    const automated = sharedAutomaticModel;
  const automatedStatus = automated?.report?.updated
    ? " · resmi TJK arşivine dayalı ortak model ileri tarih doğrulamasını geçti (kişisel tahminlerde kullanılmıyor)"
    : automated?.lastAcceptedValidation
      ? " · resmi TJK arşivine dayalı ortak model mevcut (kişisel tahminlerde kullanılmıyor)"
      : automated?.report?.verified
        ? " · resmi TJK arşivinden aday model doğrulamayı geçemedi (kişisel model etkilenmedi)"
        : " · ortak model henüz doğrulanmadı; kişisel öğrenme kendi bülten sonuçlarını kullanır";
    const learnedContexts = Object.keys(automated?.contextWeights || {}).length;
    target.textContent = `Kalıcı Neon hafızası: ${Number(memory.completedRaceCount || 0).toLocaleString("tr-TR")} sonuçlu TJK koşusu · ${memory.firstDate || "—"} – ${memory.lastDate || "—"}${automatedStatus}. Öğrenme hedefi: tüm mevcut yarış sinyallerinde ve hipodrom/zemin/tür/mesafe kesişimlerinde daha iyi ileri-tarih tahminleri bulmak; yalnızca doğrulama kazanan değişiklikleri etkinleştirmek. ${learnedContexts} doğrulanmış bağlam modeli ortak hafızada. Bu resmi arşiv ve doğrulanmış model tüm kurulumlarda ortak kullanılır; kişisel analiz geçmişi hesabınızla giriş yaptıysanız otomatik eşitlenir, aksi halde bu cihazda kalır.`;
    return memory;
  } catch {
    target.textContent = "Neon kalıcı hafızasına şu an ulaşılamıyor; bu cihazdaki kayıtlar korunuyor.";
    return null;
  }
}
let archiveSyncInProgress = false;
async function syncHistoricalArchive() {
  if (archiveSyncInProgress) return;
  archiveSyncInProgress = true;
  const status = $("archiveStatus");
  const refreshButton = $("refreshArchiveBtn");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Eşitleniyor…";
  }
  if (status) status.textContent = "TJK geçmiş arşivi kontrol ediliyor…";
  try {
    await refreshRemoteMemory();
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
    raceRelationArchive = window.RaceRelations.createIndex(archive);
    raceContextArchive = window.RaceContextPerformance.createIndex(archive);
    pedigreeHistoryArchive = window.RacePedigreeHistory.createIndex(archive);
    scoreCache = new WeakMap();
    const converted = archive.map(archiveRowToOutcome).filter(Boolean);
    let freshCount = 0;
    let correctedCount = 0;
    let refreshedClassHistoryCount = 0;
    const mergedOutcomes = [...state.outcomes];
    const outcomeIndexes = new Map();
    mergedOutcomes.forEach((outcome, index) => {
      const key = outcomeKey(outcome);
      if (!outcomeIndexes.has(key)) outcomeIndexes.set(key, index);
    });
    for (const item of converted) {
      const key = outcomeKey(item);
      const existingIndex = outcomeIndexes.get(key);
      if (existingIndex === undefined) {
        outcomeIndexes.set(key, mergedOutcomes.length);
        mergedOutcomes.push(item);
        freshCount += 1;
        continue;
      }
      const existing = mergedOutcomes[existingIndex];
      const existingHorses = new Map((existing?.horses || []).map((horse) => [Number(horse.number), horse]));
      const learnedSignalsChanged = existing?.sourceKey?.startsWith("tjk:") && item.horses.some((horse) => {
        const previousFeatures = existingHorses.get(Number(horse.number))?.features || {};
        return ["classHistory", "groupFit", "pedigree"].some((key) => Number.isFinite(horse.features?.[key]) && previousFeatures[key] !== horse.features[key]);
      });
      if (learnedSignalsChanged) {
        mergedOutcomes[existingIndex] = item;
        refreshedClassHistoryCount += 1;
      } else if (!window.RaceLearningEvaluation.isPersonalBulletinOutcome(existing) && Number(existing.winner) !== Number(item.winner)) {
        mergedOutcomes[existingIndex] = item;
        correctedCount += 1;
      }
    }
    state.outcomes = mergedOutcomes;
    state.archiveRaceCount = converted.length;
    state.archiveLatestDate = archive.map((row) => String(row.race_date || "").slice(0, 10)).sort().at(-1) || "";
    state.archiveSyncedAt = new Date().toISOString();
    saveState();
    renderTrainingReport();
    if (status) status.textContent = `Neon arşivinden ${converted.length.toLocaleString("tr-TR")} sonuçlu koşu alındı; ${freshCount.toLocaleString("tr-TR")} yeni koşu eklendi; ${correctedCount.toLocaleString("tr-TR")} eski sonuç düzeltildi. Son arşiv tarihi: ${state.archiveLatestDate || "bilinmiyor"}. ${state.trainingReport?.updated ? "Ayrılmış doğrulamada iyileşme görüldü; öğrenilmiş ağırlıklar etkin." : `Ağırlıklar ${MODEL_MIN_RACES} yarış ve ayrılmış doğrulama iyileşmesi şartıyla güncellenir.`}`;
  } catch {
    if (status) status.textContent = "Neon yarış arşivine şu an ulaşılamadı. Bu cihazdaki kayıtlar korunuyor; bağlantı kurulduğunda arşiv yeniden kontrol edilir.";
  } finally {
    archiveSyncInProgress = false;
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "Yarış arşivini eşitle";
    }
  }
}
let selectedResultImage = null;
let storedResultImage = null;
let resultImagePreviewUrl = null;
function setResultImageStatus(message, isError = false) {
  const status = $("resultsImageStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}
function readImageAsJpeg(file, { maxDimension = 1800, quality = 0.82, maxBytes = Infinity } = {}) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const sourceUrl = URL.createObjectURL(file);
    image.onload = async () => {
      URL.revokeObjectURL(sourceUrl);
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      let width = Math.max(1, Math.round(image.naturalWidth * scale));
      let height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("Görsel dönüştürülemedi."));
      let blob = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        canvas.width = width;
        canvas.height = height;
        context.drawImage(image, 0, 0, width, height);
        blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, "image/jpeg", Math.max(0.38, quality - attempt * 0.035)));
        if (blob && blob.size <= maxBytes) break;
        width = Math.max(1, Math.round(width * 0.84));
        height = Math.max(1, Math.round(height * 0.84));
      }
      if (!blob || blob.size > maxBytes) return reject(new Error("Görsel hafızaya sığacak şekilde küçültülemedi."));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Görsel okunamadı."));
      reader.readAsDataURL(blob);
    };
    image.onerror = () => { URL.revokeObjectURL(sourceUrl); reject(new Error("Bu görsel açılamadı.")); };
    image.src = sourceUrl;
  });
}
async function extractResultsFromImage() {
  if (!selectedResultImage && !storedResultImage?.dataUrl) return;
  const button = $("readResultsImageButton");
  button.disabled = true;
  button.textContent = "Görsel okunuyor…";
  setResultImageStatus("Görsel küçültülüyor ve sonuç tablosu okunuyor…");
  try {
    const image = storedResultImage?.dataUrl || await readImageAsJpeg(selectedResultImage);
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
    saveBulletinDraft("result", { text: textarea.value, date: $("resultsDateInput").value, city: $("resultsCityInput").value.trim(), ...(storedResultImage ? { image: storedResultImage } : {}) });
    textarea.focus();
    setResultImageStatus("Metin ve fotoğraf otomatik hafızaya kaydedildi. Sonuçlar kısa süre içinde otomatik karşılaştırılacak.");
    scheduleResultComparison();
  } catch (error) {
    setResultImageStatus(error instanceof Error ? error.message : "Görsel işlenemedi. Lütfen yeniden deneyin.", true);
  } finally {
    button.disabled = !selectedResultImage && !storedResultImage?.dataUrl;
    button.textContent = "Görselden metni oku";
  }
}
function compareResults() {
  const target = $("ogrenmeLogAlani");
  const resultText = $("sonucluBultenInput").value.trim();
  if (resultText || storedResultImage) archiveBulletin("result", { text: resultText, date: $("resultsDateInput").value, city: $("resultsCityInput").value.trim(), ...(storedResultImage ? { image: storedResultImage } : {}) });
  const parsed = parseRaces(resultText);
  if (!parsed.races.length) {
    showMessage(target, "Sonuç bülteninde koşu ve at sonuç satırları bulunamadı. Ekran görüntüsündeki metin bir web menüsü/başlık içeriği; sonuç tablosunu, at numarası ve Sıra/Rank/Position bilgileriyle birlikte kopyalayın.", "error");
    return;
  }
  const resultDate = $("resultsDateInput").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resultDate) || Number.isNaN(Date.parse(`${resultDate}T00:00:00Z`)) || new Date(`${resultDate}T00:00:00Z`).toISOString().slice(0, 10) !== resultDate) { showMessage(target, "Sonuç bülteninin geçerli tarihini seçin.", "error"); return; }
  if (new Set(parsed.races.map((race) => race.no)).size !== parsed.races.length) { showMessage(target, "Sonuç bülteninde aynı koşu numarası birden fazla bulundu. Yinelenen koşuyu kaldırıp yeniden deneyin.", "error"); return; }
  const datePredictions = state.predictions.filter((item) => item.date === resultDate);
  if (!datePredictions.length) {
    const savedDates = [...new Set(state.predictions.map((item) => item.date).filter(Boolean))].sort().reverse().slice(0, 5);
    const dateHint = savedDates.length ? ` Hafızadaki son tahmin tarihleri: ${savedDates.join(", ")}.` : " Bu tarayıcı hafızasında henüz tahmin kaydı yok.";
    showMessage(target, `${resultDate} tarihi için kaydedilmiş tahmin bulunamadı. Sonuç tarihiyle bülten analiz tarihi aynı olmalı; ${resultDate} gününü analiz edin.${dateHint}`, "error");
    return;
  }
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
    const racePredictions = matchingPredictions.filter((item) => Number(item.no) === Number(race.no));
    if (!winner || !Number.isSafeInteger(Number(winner.number)) || Number(winner.number) < 1) { racesWithoutWinner += 1; continue; }
    if (!racePredictions.length) { racesWithoutPrediction += 1; continue; }
    for (const prediction of racePredictions) {
      const rankedUnits = window.RaceEkuri.selectionUnits(prediction.horses);
      const winningPredictionHorse = prediction.horses.find((horse) => Number(horse.number) === Number(winner.number));
      const effectiveWinner = winningPredictionHorse?.couplingGroup ? { ...winner, couplingGroup: winningPredictionHorse.couplingGroup } : winner;
      const top3 = rankedUnits.slice(0, 3);
      const marketFavorite = prediction.horses.filter((horse) => horse.marketScore !== null).sort((a, b) => b.marketScore - a.marketScore)[0];
      const winnerPrediction = prediction.horses.find((horse) => window.RaceEkuri.sameSelection(horse, effectiveWinner));
      const singleGap = rankedUnits.length > 1 ? rankedUnits[0].score - rankedUnits[1].score : 0;
      const singleCandidate = singleGap >= SINGLE_GAP_THRESHOLD && rankedUnits[0].independentCoverage >= MIN_SINGLE_COVERAGE;
      outcomes.push({
        city: prediction.city || "",
        raceNo: race.no,
        predictionRunId: prediction.runId || null,
        predictionCreatedAt: prediction.predictionCreatedAt || null,
        sourceKey: `${prediction.date || resultDate}:${prediction.city || ""}:${race.no}${prediction.runId ? `:${prediction.runId}` : ""}`,
        winner: winner.number,
        winnerName: winner.name,
        modelVersion: prediction.modelVersion === MODEL_VERSION ? MODEL_VERSION : "legacy-ensemble-v0",
        top3Hit: top3.some((horse) => window.RaceEkuri.sameSelection(horse, effectiveWinner)),
        top1Hit: Boolean(top3[0] && window.RaceEkuri.sameSelection(top3[0], effectiveWinner)),
        favoriteMiss: marketFavorite ? !window.RaceEkuri.sameSelection(marketFavorite, effectiveWinner) : null,
        surpriseHit: winnerPrediction?.signal === "Sürpriz adayı",
        singleGap,
        singleCandidate,
        singleHit: singleCandidate && Boolean(rankedUnits[0] && window.RaceEkuri.sameSelection(rankedUnits[0], effectiveWinner)),
        horses: prediction.horses,
        surface: prediction.surface,
        type: prediction.type,
        distance: prediction.distance,
        at: `${prediction.date || timestamp.slice(0, 10)}T12:00:00.000Z`
      });
    }
  }
  if (!outcomes.length) {
    showMessage(target, `Sonuç bülteni kaydedildi ancak güvenilir bir kazanan/tahmin eşleşmesi bulunamadı. Öğrenme güncellenmedi; ${racesWithoutWinner} koşuda sıra okunamadı, ${racesWithoutPrediction} koşu tahminle eşleşmedi.`);
    return;
  }
  const merged = window.RaceLearningEvaluation.mergeOutcomes(state.outcomes, outcomes);
  state.outcomes = merged.outcomes;
  if (merged.added || merged.corrected) trainModel();
  const saved = saveState();
  const duplicates = outcomes.length - merged.added - merged.corrected;
  const report = state.trainingReport || {};
  const learningStatus = report.updated
    ? "İleri tarih doğrulaması geçti; yeni model ağırlıkları etkinleştirildi."
    : report.verified
      ? "Sonuçlar öğrenme arşivine eklendi; doğrulama eşiği geçilmediği için mevcut ağırlıklar korundu."
      : `Sonuçlar öğrenme arşivine eklendi; model için henüz yeterli doğrulama verisi yok (en az ${MODEL_MIN_RACES} uygun yarış gerekli).`;
  const auditRaces = parsed.races.flatMap((race) => {
    const runs = matchingPredictions.filter((item) => Number(item.no) === Number(race.no)).sort((a, b) => String(a.predictionCreatedAt || "").localeCompare(String(b.predictionCreatedAt || "")));
    const winner = race.horses.find((horse) => horse.place === 1);
    if (!winner || !runs.length) return [];
    const leaders = runs.map((run) => window.RaceEkuri.selectionUnits(run.horses)[0]).filter(Boolean);
    const latest = runs.at(-1);
    const latestRanking = window.RaceEkuri.selectionUnits(latest.horses);
    const winnerHorse = latest.horses.find((horse) => Number(horse.number) === Number(winner.number));
    const effectiveWinner = winnerHorse?.couplingGroup ? { ...winner, couplingGroup: winnerHorse.couplingGroup } : winner;
    const winnerRank = latestRanking.findIndex((horse) => window.RaceEkuri.sameSelection(horse, effectiveWinner)) + 1;
    const latestHit = Boolean(latestRanking[0] && window.RaceEkuri.sameSelection(latestRanking[0], effectiveWinner));
    const leaderNumbers = leaders.map((horse) => horse.members?.map((member) => member.number).join("+") || horse.number);
    const uniqueLeaders = new Set(leaderNumbers);
    const runPath = uniqueLeaders.size > 1 ? `lider değişti ${leaderNumbers.join(" → ")}` : `lider sabit #${leaderNumbers[0]}`;
    const time = latest.predictionCreatedAt ? new Date(latest.predictionCreatedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "saat bilgisi yok";
    return [`<div class="alert">${race.no}. koşu · ${runs.length} analiz · ${runPath} · kazanan #${winner.number} ${escapeHtml(winner.name)} · son analiz ${time}: ${latestHit ? "isabet" : "kaçırdı"}${winnerRank ? ` (${winnerRank}. sırada)` : " (tahminde yok)"}</div>`];
  }).join("");
  const leadersCorrect = outcomes.filter((item) => item.top1Hit).length;
  const topThreeCorrect = outcomes.filter((item) => item.top3Hit).length;
  const stableRaceCount = parsed.races.filter((race) => {
    const leaders = matchingPredictions.filter((item) => Number(item.no) === Number(race.no)).map((run) => {
      const leader = window.RaceEkuri.selectionUnits(run.horses)[0];
      return leader?.members?.map((member) => member.number).join("+") || leader?.number;
    }).filter(Boolean);
    return new Set(leaders).size <= 1;
  }).length;
  const outcomeDetails = `<section class="card"><h3>Kısa olay yeri incelemesi</h3><p class="sub">${outcomes.length} kayıtlı tahmin sürümü · ${stableRaceCount}/${parsed.races.length} koşuda lider değişmedi · sürüm bazında lider isabeti ${leadersCorrect}/${outcomes.length} · ilk üç isabeti ${topThreeCorrect}/${outcomes.length}.</p>${auditRaces}</section>`;
  showMessage(target, `${saved ? "Sonuç bülteni otomatik karşılaştırıldı ve hafızaya kaydedildi." : "Karşılaştırma yapıldı ancak hafızaya kaydetme başarısız oldu."} ${merged.added} yeni sürüm sonucu · ${merged.corrected} düzeltilen sonuç · ${duplicates} yinelenen · ${racesWithoutWinner + racesWithoutPrediction} atlanan koşu. ${learningStatus}`, saved ? "success" : "error");
  target.insertAdjacentHTML("beforeend", outcomeDetails);
  renderTrainingReport();
  updateMemory();
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function handleCompareResults() {
  try {
    compareResults();
  } catch {
    showMessage($("ogrenmeLogAlani"), "Sonuçlar işlenirken beklenmeyen bir hata oluştu. Girdi alanlarını kontrol edip yeniden deneyin; kayıtlı hafıza korunuyor.", "error");
  }
}
function scheduleResultComparison() {
  clearTimeout(resultCompareTimer);
  if (!$('sonucluBultenInput')?.value.trim()) return;
  resultCompareTimer = window.setTimeout(handleCompareResults, 900);
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
    legs: coupon.picks.map((pick) => ({ raceNo: pick.no, externalSignals: pick.externalSignals || null, horses: pick.ranked.slice(0, pick.count).flatMap((unit) => unit.members || [unit]).map((horse) => ({ number: horse.number, name: horse.name, modelShare: horse.modelShare, couplingGroup: horse.couplingGroup || "" })) })),
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
  return state.predictions.filter((prediction) => prediction.date === date && normalize(prediction.city || "") === normalize(city || "") && Number(prediction.no) === Number(raceNo)).sort((a, b) => String(b.predictionCreatedAt || "").localeCompare(String(a.predictionCreatedAt || "")))[0];
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
  $("historyArea").innerHTML = n ? `<table class="table"><thead><tr><th>Hipodrom / koşu</th><th>Kazanan</th><th>İlk üç</th><th>Lider</th><th>Tarih</th></tr></thead><tbody>${state.outcomes.slice(-30).reverse().map((item) => `<tr><td>${escapeHtml(item.city || "Manuel")} · ${item.raceNo}</td><td>#${item.winner} ${escapeHtml(item.winnerName)}</td><td>${item.top3Hit ? "Evet" : "Hayır"}</td><td>${item.top1Hit ? "Evet" : "Hayır"}</td><td>${new Date(item.at).toLocaleDateString("tr-TR")}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Karşılaştırma geçmişi henüz yok.</p>`;
  renderCouponHistory();
}

function resetHistory() {
  const scope = firebaseAccount ? "Bu cihazdaki ve Firebase hesabınızdaki" : "Bu tarayıcıdaki";
  if (!window.confirm(`${scope} bülten arşivi, fotoğraflar, yarış sonuçları ve kupon sonuç kayıtları silinsin mi?`)) return;
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
  $("goToBulletinButton")?.addEventListener("click", () => setTab("bulten"));
  const todayLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("couponDateInput").value = todayLocal;
  $("resultsDateInput").value = todayLocal;
  $("manualCouponDate").value = todayLocal;
  const savedProgramDraft = state.bulletins.find((item) => item.id === "draft-program");
  const savedResultDraft = state.bulletins.find((item) => item.id === "draft-result");
  if (savedProgramDraft) {
    $("hamBultenInput").value = savedProgramDraft.text || "";
    if (savedProgramDraft.date) $("couponDateInput").value = savedProgramDraft.date;
    if (savedProgramDraft.city) $("couponCityInput").value = savedProgramDraft.city;
    if (savedProgramDraft.budget) $("butceInput").value = savedProgramDraft.budget;
    if (savedProgramDraft.unit) $("birimInput").value = savedProgramDraft.unit;
  }
  if (savedResultDraft) {
    $("sonucluBultenInput").value = savedResultDraft.text || "";
    if (savedResultDraft.date) $("resultsDateInput").value = savedResultDraft.date;
    if (savedResultDraft.city) $("resultsCityInput").value = savedResultDraft.city;
    applySavedResultDraftImage();
  }
  restoreLatestPredictionTarget();
  $("hamBultenInput")?.addEventListener("input", () => saveBulletinDraft("program", { text: $("hamBultenInput").value, date: $("couponDateInput").value, city: $("couponCityInput").value.trim() }));
  $("couponDateInput")?.addEventListener("change", () => saveBulletinDraft("program", { text: $("hamBultenInput").value, date: $("couponDateInput").value, city: $("couponCityInput").value.trim() }));
  $("couponCityInput")?.addEventListener("input", () => saveBulletinDraft("program", { text: $("hamBultenInput").value, date: $("couponDateInput").value, city: $("couponCityInput").value.trim() }));
  $("butceInput")?.addEventListener("input", () => saveBulletinDraft("program", { text: $("hamBultenInput").value, date: $("couponDateInput").value, city: $("couponCityInput").value.trim(), budget: $("butceInput").value }));
  $("birimInput")?.addEventListener("input", () => saveBulletinDraft("program", { text: $("hamBultenInput").value, date: $("couponDateInput").value, city: $("couponCityInput").value.trim(), unit: $("birimInput").value }));
  $("sonucluBultenInput")?.addEventListener("input", () => saveBulletinDraft("result", { text: $("sonucluBultenInput").value, date: $("resultsDateInput").value, city: $("resultsCityInput").value.trim() }));
  $("sonucluBultenInput")?.addEventListener("paste", scheduleResultComparison);
  $("resultsDateInput")?.addEventListener("change", () => {
    saveBulletinDraft("result", { text: $("sonucluBultenInput").value, date: $("resultsDateInput").value, city: $("resultsCityInput").value.trim() });
    scheduleResultComparison();
  });
  $("resultsCityInput")?.addEventListener("input", () => {
    saveBulletinDraft("result", { text: $("sonucluBultenInput").value, date: $("resultsDateInput").value, city: $("resultsCityInput").value.trim() });
    scheduleResultComparison();
  });
  $("manualCouponForm")?.addEventListener("submit", addManualCoupon);
  $("couponHistoryArea")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-update-coupon]");
    if (button) updateCouponResult(button.dataset.updateCoupon, button.closest("[data-coupon-card]"));
  });
  $("kuponAlani")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-coupon]");
    if (button) saveGeneratedCoupon(button.dataset.saveCoupon);
  });
  $("analyzeButton")?.addEventListener("click", analyze);
  $("clearButton")?.addEventListener("click", () => { $("hamBultenInput").value = ""; saveBulletinDraft("program", { text: "", date: $("couponDateInput").value, city: $("couponCityInput").value.trim() }); $("bultenUyariAlani").innerHTML = ""; });
  $("chooseResultsImageButton")?.addEventListener("click", () => $("resultsImageInput")?.click());
  $("resultsImageInput")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 15 * 1024 * 1024) {
      selectedResultImage = null;
      storedResultImage = null;
      $("readResultsImageButton").disabled = true;
      $("resultsImagePreview").hidden = true;
      setResultImageStatus("JPG, PNG veya WebP biçiminde ve 15 MB’tan küçük bir görsel seçin.", true);
      return;
    }
    selectedResultImage = file;
    $("readResultsImageButton").disabled = true;
    const preview = $("resultsImagePreview");
    if (resultImagePreviewUrl) URL.revokeObjectURL(resultImagePreviewUrl);
    resultImagePreviewUrl = URL.createObjectURL(file);
    preview.src = resultImagePreviewUrl;
    preview.hidden = false;
    setResultImageStatus("Fotoğraf küçültülüyor ve hafızaya kaydediliyor…");
    try {
      const dataUrl = await readImageAsJpeg(file, { maxDimension: 1200, quality: 0.68, maxBytes: 450 * 1024 });
      storedResultImage = { name: file.name, type: "image/jpeg", dataUrl, savedAt: new Date().toISOString() };
      let blobSaved = false;
      if (firebaseAccount && firebaseSyncReady) {
        try {
          storedResultImage = { ...storedResultImage, ...await uploadResultImage(storedResultImage, firebaseAccount), dataUrl };
          blobSaved = true;
        } catch { /* The local and Firebase copies remain available for a later Blob retry. */ }
      }
      saveBulletinDraft("result", { text: $("sonucluBultenInput").value, date: $("resultsDateInput").value, city: $("resultsCityInput").value.trim(), image: storedResultImage });
      $("readResultsImageButton").disabled = false;
      setResultImageStatus(blobSaved ? `${file.name} fotoğrafı özel Blob hafızasına kaydedildi.` : `${file.name} fotoğrafı bu cihazın hafızasına kaydedildi; giriş yaptığınızda Firebase ve Blob ile eşitlenir.`);
    } catch (error) {
      selectedResultImage = null;
      storedResultImage = null;
      setResultImageStatus(error instanceof Error ? error.message : "Fotoğraf hafızaya kaydedilemedi.", true);
    }
  });
  $("readResultsImageButton")?.addEventListener("click", extractResultsFromImage);
  $("learnButton")?.addEventListener("click", handleCompareResults);
  $("exportBackupBtn").addEventListener("click", exportBackup);
  $("refreshArchiveBtn")?.addEventListener("click", syncHistoricalArchive);
  $("importBackupInput").addEventListener("change", (event) => {
    importBackup(event.target.files?.[0]);
    event.target.value = "";
  });
  $("resetBtn")?.addEventListener("click", resetHistory);
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
  refreshRemoteMemory();
});
