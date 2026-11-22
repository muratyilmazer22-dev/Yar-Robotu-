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
const STORAGE_KEY = "race-analysis-v1";
const BASE_WEIGHTS = { rating: 0.3, form: 0.3, market: 0.25, pedigree: 0.15 };
const MODEL_MIN_RACES = 30;
const TRAINING_WINDOW_RACES = 2000;
const SINGLE_GAP_THRESHOLD = 12.5;
const ROBOT_STRATEGIES = [
  { name: "Öğrenen denge", weights: null },
  { name: "Form", weights: { rating: 0.18, form: 0.46, market: 0.21, pedigree: 0.15 } },
  { name: "Piyasa", weights: { rating: 0.18, form: 0.16, market: 0.52, pedigree: 0.14 } },
  { name: "Handikap", weights: { rating: 0.5, form: 0.18, market: 0.2, pedigree: 0.12 } },
  { name: "Pedigri", weights: { rating: 0.18, form: 0.18, market: 0.18, pedigree: 0.46 } },
  { name: "Eşit ağırlık", weights: { rating: 0.25, form: 0.25, market: 0.25, pedigree: 0.25 } },
  { name: "Piyasa dışı", weights: { rating: 0.38, form: 0.38, market: 0, pedigree: 0.24 } },
  { name: "Temkinli", weights: { rating: 0.28, form: 0.24, market: 0.34, pedigree: 0.14 } }
];
let scoreCache = new WeakMap();
const DEFAULT_STATE = { version: 3, profiles: {}, predictions: [], outcomes: [], coupons: [], modelWeights: { ...BASE_WEIGHTS }, contextWeights: {} };
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
  return {
    ...DEFAULT_STATE,
    ...(saved && typeof saved === "object" ? saved : {}),
    version: 3,
    profiles: { ...DEFAULT_PROFILES, ...(saved?.profiles || {}) },
    predictions: Array.isArray(saved?.predictions) ? saved.predictions : [],
    outcomes: Array.isArray(saved?.outcomes) ? saved.outcomes : [],
    coupons: Array.isArray(saved?.coupons) ? saved.coupons : [],
    modelWeights: { ...BASE_WEIGHTS, ...(saved?.modelWeights || {}) },
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
let deferredInstallPrompt = null;
let firebaseSdk = null;
let firebaseAccount = null;
let firebaseSyncReady = false;
let firebaseSaveTimer = null;
let firebaseSyncChain = Promise.resolve();
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
function mergeMemoryRecords(remoteRecords, localRecords, keyOf) {
  const merged = new Map();
  for (const item of remoteRecords || []) merged.set(keyOf(item), item);
  for (const item of localRecords || []) merged.set(keyOf(item), item);
  return [...merged.values()];
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
    predictions: mergeMemoryRecords(remoteState.predictions, localState.predictions, (item) => `${item.date || ""}:${item.city || ""}:${item.no ?? ""}`),
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
      state = remoteMemory ? mergeFirebaseMemory(localMemory, remoteMemory) : normalizeState(localMemory);
      state.firebaseOwnerUid = user.uid;
      state.localUpdatedAt = new Date().toISOString();
      if (state.predictions?.length) lastAnalysis = state.predictions;
      persistStateLocally();
      updateMemory();
      firebaseSyncReady = true;
      await api.saveMemory(user, JSON.parse(JSON.stringify(state)));
      setFirebaseStatus(`Hafıza Firebase hesabınızla eşitlendi: ${user.email || user.uid}`);
    } catch {
      firebaseSyncReady = false;
      setFirebaseStatus("Firebase verisi okunamadı. Yerel kayıtlar korundu; Firestore kurallarına users/{uid} için yalnızca aynı kullanıcı erişimini ekleyin.", true);
    }
  });
}
function saveState() {
  state.localUpdatedAt = new Date().toISOString();
  persistStateLocally();
  updateMemory();
  queueFirebaseMemorySync();
}
function showMessage(target, text, type = "") { target.innerHTML = `<div class="alert ${type}">${escapeHtml(text)}</div>`; }
function setTab(name) {
  document.querySelectorAll(".tab").forEach((button) => { const active = (button.dataset.tab || button.dataset.panel) === name; button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1; });
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${name}`));
}
function normalize(text) { return text.toLocaleUpperCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "I"); }
function parseNumber(value) { const result = Number(String(value || "").replace(",", ".")); return Number.isFinite(result) ? result : null; }
function parseRaces(text) {
  const lines = text.split(/\r?\n/);
  const races = [];
  let race = null;
  let warnings = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(/^(\d+)\.\s*Koşu\s+(?:(\d{1,2}[.:]\d{2})\s*)?(.*)$/i);
    if (header) {
      if (race) races.push(race);
      const detail = header[3] || "";
      const distance = detail.match(/(\d{3,4})\s*m?\s*(Kum|Çim|Sentetik)/i);
      const surface = detail.match(/(?:^|\s)(Kum|Çim|Sentetik)(?=\s|$|[,.;])/i);
      const className = normalize(detail);
      race = { no: Number(header[1]), time: header[2] || "", title: detail.trim(), distance: distance ? Number(distance[1]) : 1400, surface: surface?.[1] || "Belirtilmemiş", horses: [] };
      race.type = className.includes("HANDIKAP") ? "HANDIKAP" : className.includes("MAIDEN") || className.includes("SATIS") ? "MAIDEN / SATIŞ" : "DİĞER";
      continue;
    }
    if (!race) continue;
    const columns = raw.split("\t").map((column) => column.trim());
    if (columns.length < 2 || !/^\d+$/.test(columns[0])) continue;
    const number = Number(columns[0]);
    const nameColumn = columns[1] || "";
    const placeMatch = nameColumn.match(/\((\d{1,2})\)/);
    const scratched = /koşmaz|scratched/i.test(raw);
    const name = nameColumn.replace(/\(\d{1,2}\)|\(Koşmaz\)/gi, "").replace(/\b(KG|DB|SKG|SK|GKR|YP|ÇP|BB)\b/g, "").trim();
    const origin = columns.find((column, index) => index >= 2 && /[-/]/.test(column) && !/^\d/.test(column)) || "";
    const [sire = "", damSire = ""] = origin.split(/[/-]/).map((part) => part.replace(/\([^)]*\)/g, "").trim());
    const all = columns.slice(2).join(" ");
    const odds = all.match(/(?:^|\s)(\d+[.,]\d{1,2})(?=\s|$)/);
    const agf = all.match(/%(\d+(?:[.,]\d+)?)(?:\((\d+)\))?/);
    const hpValue = parseNumber(columns[9]);
    const hp = hpValue !== null && hpValue >= 1 && hpValue <= 200 ? hpValue : null;
    const last6 = /^\d{2,6}$/.test(columns[10] || "") ? columns[10] : "";
    if (!name) continue;
    race.horses.push({ number, name, sire, damSire, odds: odds ? parseNumber(odds[1]) : null, agf: agf ? parseNumber(agf[1]) : null, hp, last6, place: placeMatch ? Number(placeMatch[1]) : null, scratched });
  }
  if (race) races.push(race);
  for (const item of races) {
    const placed = item.horses.filter((horse) => Number.isInteger(horse.place) && horse.place > 0);
    const places = placed.map((horse) => horse.place);
    item.finished = placed.length >= 2 && places.includes(1);
  }
  const filtered = races.filter((item) => item.horses.length > 0);
  if (!filtered.length) warnings.push("Koşu ve at satırı bulunamadı. TJK metnini sekme ayrımları korunacak şekilde yeniden kopyalayın.");
  for (const item of races) if (!item.horses.length) warnings.push(`${item.no}. koşuda okunabilir at satırı bulunamadı.`);
  return { races: filtered, warnings };
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
function scoreRaceWithWeights(race, weights) {
  const active = race.horses.filter((horse) => !horse.scratched);
  const maxHp = Math.max(1, ...active.map((horse) => horse.hp || 0));
  const maxAgf = Math.max(1, ...active.map((horse) => horse.agf || 0));
  const validOdds = active.map((horse) => horse.odds).filter((odds) => odds > 0);
  const favoriteOdds = Math.min(...validOdds);
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 1;
  const ranked = active.map((horse) => {
    const recent = horse.last6 ? [...horse.last6].slice(0, 6).map(Number).filter((n) => n >= 1 && n <= 9) : [];
    const sire = profileScore(horse.sire, race.distance);
    const damSire = profileScore(horse.damSire, race.distance);
    const agfScore = horse.agf > 0 ? horse.agf / maxAgf * 100 : null;
    const oddsScore = horse.odds > 0 && Number.isFinite(favoriteOdds) ? favoriteOdds / horse.odds * 100 : null;
    const market = agfScore !== null && oddsScore !== null ? agfScore * 0.65 + oddsScore * 0.35 : agfScore ?? oddsScore;
    const features = {
      rating: horse.hp ? horse.hp / maxHp * 100 : null,
      form: recent.length ? recent.reduce((sum, place) => sum + (10 - place), 0) / recent.length * 10 : null,
      market,
      pedigree: sire !== null && damSire !== null ? sire * 0.65 + damSire * 0.35 : sire ?? damSire
    };
    const availableWeight = Object.entries(features).reduce((sum, [key, value]) => sum + (value === null ? 0 : weights[key]), 0);
    const score = availableWeight
      ? Object.entries(features).reduce((sum, [key, value]) => sum + (value === null ? 0 : value * weights[key]), 0) / availableWeight
      : null;
    const nonMarketKeys = ["rating", "form", "pedigree"].filter((key) => features[key] !== null);
    const nonMarketWeight = nonMarketKeys.reduce((sum, key) => sum + weights[key], 0);
    const performanceScore = nonMarketWeight
      ? nonMarketKeys.reduce((sum, key) => sum + features[key] * weights[key], 0) / nonMarketWeight
      : null;
    const independentCoverage = Math.round(nonMarketWeight / (totalWeight - weights.market || 1) * 100);
    const coverage = Math.round(availableWeight / totalWeight * 100);
    const signal = performanceScore === null || features.market === null
      ? "Veri yetersiz"
      : performanceScore - features.market >= 12
        ? "Sürpriz adayı"
        : features.market - performanceScore >= 15
          ? "Favori riski"
          : "Sinyaller uyumlu";
    return {
      ...horse,
      score: score === null ? 50 : Math.round(score * 10) / 10,
      features,
      performanceScore: performanceScore === null ? null : Math.round(performanceScore * 10) / 10,
      marketScore: features.market === null ? null : Math.round(features.market * 10) / 10,
      coverage,
      independentCoverage,
      signal
    };
  });
  const modelShares = softmaxScores(ranked, weights);
  ranked.forEach((horse, index) => { horse.modelShare = modelShares[index]; });
  return ranked.sort((a, b) => b.modelShare - a.modelShare);
}
function scoreRace(race) {
  const cached = scoreCache.get(race);
  if (cached) return cached;
  const contextKey = `${race.surface || ""}|${race.type || ""}`;
  const adaptiveWeights = { ...BASE_WEIGHTS, ...state.modelWeights, ...(state.contextWeights?.[contextKey] || {}) };
  const robotRankings = ROBOT_STRATEGIES.map((robot) => ({
    name: robot.name,
    ranked: scoreRaceWithWeights(race, robot.weights ? { ...BASE_WEIGHTS, ...robot.weights } : adaptiveWeights)
  }));
  const horseStats = new Map();
  for (const { name, ranked } of robotRankings) {
    ranked.forEach((horse, index) => {
      const stats = horseStats.get(horse.number) || { horse, rankTotal: 0, scoreTotal: 0, shareTotal: 0, topThreeCount: 0, firstChoiceCount: 0, firstChoiceRobots: [] };
      stats.rankTotal += index + 1;
      stats.scoreTotal += horse.score;
      stats.shareTotal += horse.modelShare;
      if (index < 3) stats.topThreeCount += 1;
      if (index === 0) {
        stats.firstChoiceCount += 1;
        stats.firstChoiceRobots.push(name);
      }
      horseStats.set(horse.number, stats);
    });
  }
  const fieldSize = Math.max(1, horseStats.size);
  const combined = [...horseStats.values()].map(({ horse, rankTotal, scoreTotal, shareTotal, topThreeCount, firstChoiceCount, firstChoiceRobots }) => {
    const averageRank = rankTotal / ROBOT_STRATEGIES.length;
    const consensusScore = (fieldSize === 1 ? 100 : (fieldSize - averageRank) / (fieldSize - 1) * 100) * 0.8 + scoreTotal / ROBOT_STRATEGIES.length * 0.2;
    return {
      ...horse,
      score: Math.round(consensusScore * 10) / 10,
      modelShare: shareTotal / ROBOT_STRATEGIES.length,
      robotTopThreeCount: topThreeCount,
      robotFirstChoiceCount: firstChoiceCount,
      robotFirstChoices: firstChoiceRobots
    };
  }).sort((a, b) => b.score - a.score || b.modelShare - a.modelShare || Number(a.number) - Number(b.number));
  scoreCache.set(race, combined);
  return combined;
}
async function analyzeWithDeterministicRobots(races) {
  const results = [];
  for (const race of races) {
    results.push(scoreRace(race));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { results, robotCount: ROBOT_STRATEGIES.length };
}
function renderAnalysis(races, targetId = "kosuSonucAlani") {
  const target = $(targetId);
  target.innerHTML = races.map((race) => {
    const heading = `<h3>${race.no}. Koşu${race.time ? ` · ${escapeHtml(race.time)}` : ""} · ${escapeHtml(race.distance)} m ${escapeHtml(race.surface)} <span class="muted">· ${escapeHtml(race.type)}</span></h3>`;
    if (race.finished) return `<article class="race">${heading}<p class="alert">Koşuldu · sonuç verisi bulundu. Bu ayak için tahmin gösterilmiyor.</p></article>`;
    const ranked = scoreRace(race);
    return `<article class="race">${heading}${ranked.length ? ranked.map((horse, index) => `<div class="horse"><strong>#${horse.number}</strong><span>${escapeHtml(horse.name)}${index === 0 ? " <small>· modelin ilk tercihi</small>" : ""}<br><small>Model payı %${Math.round(horse.modelShare * 100)} · ${horse.robotTopThreeCount}/${ROBOT_STRATEGIES.length} robotun ilk 3’ünde · ${horse.robotFirstChoiceCount} robotun ilk tercihi · ${horse.signal} · Veri kapsamı %${horse.coverage}</small></span><span class="score">${horse.score.toFixed(1)}</span><small>${horse.agf === null ? "AGF yok" : `AGF %${horse.agf}`}${horse.odds === null ? " · Oran yok" : ` · Oran ${horse.odds}`}${horse.hp === null ? " · HP yok" : ` · HP ${horse.hp}`}</small></div>`).join("") : "<p class=muted>Koşabilir at bulunamadı.</p>"}</article>`;
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

  const picks = openLegs.map(({ race, ranked }) => ({ no: race.no, ranked, count: 1 }));
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
  if (allHorsesFit) {
    picks.forEach((pick) => { pick.count = pick.ranked.length; });
    columns = fullColumns;
  } else {
    let states = new Map([[1, { score: 0, counts: [] }]]);
    for (const pick of picks) {
      const nextStates = new Map();
      const cumulativeShares = [];
      pick.ranked.forEach((horse, index) => {
        cumulativeShares[index] = (cumulativeShares[index - 1] || 0) + horse.modelShare;
      });
      for (const [usedColumns, state] of states) {
        for (let count = 1; count <= pick.ranked.length; count++) {
          if (usedColumns > maxColumns / count) continue;
          const nextColumns = usedColumns * count;
          const score = state.score + Math.log(cumulativeShares[count - 1]);
          const previous = nextStates.get(nextColumns);
          if (!previous || score > previous.score) {
            nextStates.set(nextColumns, { score, counts: [...state.counts, count] });
          }
        }
      }
      states = nextStates;
    }
    let best = null;
    for (const [usedColumns, state] of states) {
      if (!best || state.score > best.score) best = { ...state, columns: usedColumns };
    }
    picks.forEach((pick, index) => { pick.count = best.counts[index]; });
    columns = best.columns;
  }

  for (const pick of picks) {
    pick.modelCoverage = pick.ranked.slice(0, pick.count).reduce((sum, horse) => sum + horse.modelShare, 0);
    pick.budgetNarrowed = pick.count < pick.ranked.length && columns / pick.count * (pick.count + 1) > maxColumns;
  }
  return { picks, columns, total: Math.round(columns * unit * 100) / 100, budget, maxColumns, budgetNarrowed: picks.some((pick) => pick.budgetNarrowed), finishedNos };
}
function formatCoupon(coupon, title, poolKey) {
  if (coupon.error) return `<div class="card"><h2>${title}</h2><div class="alert error">${escapeHtml(coupon.error)}</div></div>`;
  if (coupon.completedOnly) return `<div class="card"><h2>${title}</h2><p class="hint">Bu altılıdaki tüm ayaklar koşuldu; analiz/tahmin ve kupon hesabı gösterilmiyor.</p></div>`;
  const completed = coupon.finishedNos?.length ? `<p class="hint">Koşuldu, hesap dışında: ${coupon.finishedNos.map((no) => `${no}. koşu`).join(", ")}.</p>` : "";
  const warning = coupon.budgetNarrowed ? `<div class="alert">Bütçe sınırı bazı ayaklarda tek seçime neden oldu; bu, “banko” veya garanti anlamına gelmez.</div>` : "";
  const trainingNote = state.trainingReport?.updated
    ? `Sonuç geçmişinden öğrenilen ve doğrulama grubunda iyileşen ağırlıklar kullanılıyor (${state.trainingReport.sampleSize} yarış).`
    : `Doğrulamada iyileşme göstermiş öğrenilmiş ağırlık bulunmadığından başlangıç ağırlıkları kullanılıyor (${state.trainingReport?.sampleSize || 0} eğitim yarışı).`;
  return `<div class="card"><h2>${title} · otomatik kurgu</h2><p class="hint">${trainingNote} Sistem, seçilen atların model payını bütçeye göre dağıtır. Model payları gerçek kazanma olasılığı veya garanti değildir.</p>${warning}${coupon.picks.map((pick) => {
    const horses = pick.ranked.slice(0, pick.count);
    const horseLabels = horses.map((horse) => `#${horse.number} ${escapeHtml(horse.name)} · model payı %${Math.round(horse.modelShare * 100)}`).join(", ");
    const singleLabel = horses.length === 1 ? pick.budgetNarrowed ? " · bütçe sınırında tek seçim" : " · tek seçim" : "";
    return `<div class="alert"><b>${pick.no}. Koşu · ${horses.length} at${singleLabel} · seçilen model payı %${Math.round(pick.modelCoverage * 100)}:</b> ${horseLabels}</div>`;
  }).join("")}${completed}<b>${coupon.columns} kolon · ${coupon.total.toFixed(2)} TL / ${coupon.budget.toFixed(2)} TL bütçe</b><div><button class="btn secondary coupon-save" type="button" data-save-coupon="${poolKey}">Bu kuponu sonuç takibine kaydet</button></div></div>`;
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
  scoreCache = new WeakMap();
  const openRaces = parsed.races.filter((race) => !race.finished);
  const { results, robotCount } = openRaces.length
    ? await analyzeWithDeterministicRobots(openRaces)
    : { results: [], robotCount: 0 };
  lastAnalysis = openRaces.map((race, index) => ({
    no: race.no,
    date: couponDate,
    city: couponCity,
    surface: race.surface,
    type: race.type,
    distance: race.distance,
    horses: results[index].map((horse) => ({ number: horse.number, name: horse.name, score: horse.score, modelShare: horse.modelShare, features: horse.features, performanceScore: horse.performanceScore, marketScore: horse.marketScore, coverage: horse.coverage, independentCoverage: horse.independentCoverage, signal: horse.signal }))
  }));
  state.predictions = lastAnalysis;
  saveState();
  renderAnalysis(parsed.races);
  const completedCount = parsed.races.filter((race) => race.finished).length;
  const statusMessage = openRaces.length
    ? `${openRaces.length} açık koşu ${robotCount} deterministik analiz robotuyla işlendi; ${completedCount} koşulmuş ayak tahmin dışında bırakıldı.`
    : `${completedCount} koşunun tamamı koşulmuş; tahmin üretilmedi.`;
  if (parsed.warnings.length) showMessage(warning, `${statusMessage} ${parsed.warnings.join(" ")}`, "");
  else showMessage(warning, `${statusMessage} Açık ayaklarda AGF/oran piyasa sinyaliyle HP/form/pedigri bağımsız performans sinyalleri ayrıştırılır.`, "success");
  const budget = parseNumber($("butceInput").value);
  const unit = parseNumber($("birimInput").value);
  const firstLegs = parsed.races.filter((race) => race.no >= 1 && race.no <= 6);
  const first = firstLegs.length === 6
    ? buildCoupon(firstLegs, budget, unit)
    : { error: `Birinci altılı için 1–6. koşuların tamamı gerekli. Şu an ${firstLegs.length}/6 koşu okundu.` };
  const secondLegs = parsed.races.filter((race) => race.no >= 7 && race.no <= 12);
  const second = secondLegs.length === 6 ? buildCoupon(secondLegs, budget, unit) : null;
  lastCoupons = { first, second };
  $("kuponAlani").innerHTML = formatCoupon(first, "Birinci altılı · 1–6. koşular", "first") + (second
    ? formatCoupon(second, "İkinci altılı · 7–12. koşular", "second")
    : `<div class="card"><h2>İkinci altılı</h2><p class="hint">İkinci altılı için bültende 7–12. koşuların tamamı bulunmalı. Şu an ${secondLegs.length}/6 koşu okundu.</p></div>`);
  setTab("analiz");
}
function softmaxScores(horses, weights) {
  const scores = horses.map((horse) => {
    const features = horse.features || {};
    const available = Object.entries(features).filter(([, value]) => Number.isFinite(value));
    const weightTotal = available.reduce((sum, [key]) => sum + weights[key], 0);
    return weightTotal ? available.reduce((sum, [key, value]) => sum + value * weights[key], 0) / weightTotal : 50;
  });
  const logits = scores.map((score) => score / 12.5);
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
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
function fitModelWeights(races, referenceWeights) {
  if (races.length < MODEL_MIN_RACES) return null;
  const splitIndex = Math.floor(races.length * 0.8);
  const training = races.slice(0, splitIndex);
  const validation = races.slice(splitIndex);
  if (validation.length < 5) return null;
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
  const learnedBrier = brierScore(validation, candidate);
  const updated = learnedBrier < baselineBrier * 0.98;
  return { sampleSize: races.length, baselineBrier, validationBrier: updated ? learnedBrier : baselineBrier, updated, weights: updated ? candidate : referenceWeights };
}
function trainModel() {
  const races = state.outcomes.filter((item) => Array.isArray(item.horses) && item.horses.length > 1 && item.horses.some((horse) => horse.number === item.winner)).sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))).slice(-TRAINING_WINDOW_RACES);
  const globalFit = fitModelWeights(races, state.modelWeights);
  if (globalFit) state.modelWeights = globalFit.weights;
  state.trainingReport = {
    sampleSize: races.length,
    minimum: MODEL_MIN_RACES,
    baselineBrier: globalFit?.baselineBrier ?? null,
    validationBrier: globalFit?.validationBrier ?? null,
    updated: Boolean(globalFit?.updated),
    validatedAt: globalFit ? new Date().toISOString() : null
  };
  const contexts = new Map();
  for (const race of races) {
    if (!race.surface || !race.type) continue;
    const key = `${race.surface}|${race.type}`;
    if (!contexts.has(key)) contexts.set(key, []);
    contexts.get(key).push(race);
  }
  const contextWeights = {};
  const contextReports = {};
  for (const [key, contextRaces] of contexts) {
    const referenceWeights = state.contextWeights?.[key] || state.modelWeights;
    const fit = fitModelWeights(contextRaces, referenceWeights);
    if (!fit) continue;
    contextWeights[key] = fit.weights;
    contextReports[key] = { sampleSize: fit.sampleSize, updated: fit.updated, validationBrier: fit.validationBrier };
  }
  state.contextWeights = contextWeights;
  state.contextReports = contextReports;
}
function outcomeKey(item) {
  return item.sourceKey || `${String(item.at || "").slice(0, 10)}:${item.city || ""}:${item.raceNo}:${item.winner}`;
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
  const singleCandidate = singleGap >= SINGLE_GAP_THRESHOLD && scored[0].independentCoverage >= 50;
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
    const converted = archive.map(archiveRowToOutcome).filter(Boolean);
    const known = new Set(state.outcomes.map(outcomeKey));
    const fresh = converted.filter((item) => !known.has(outcomeKey(item)));
    if (fresh.length) {
      state.outcomes.push(...fresh);
      trainModel();
    }
    state.archiveRaceCount = converted.length;
    state.archiveLatestDate = archive.map((row) => String(row.race_date || "").slice(0, 10)).sort().at(-1) || "";
    state.archiveSyncedAt = new Date().toISOString();
    saveState();
    if (status) status.textContent = `Neon arşivinden ${converted.length.toLocaleString("tr-TR")} sonuçlu koşu alındı; ${fresh.length.toLocaleString("tr-TR")} yeni koşu öğrenme hafızasına eklendi. Son arşiv tarihi: ${state.archiveLatestDate || "bilinmiyor"}. ${state.trainingReport?.updated ? "Ayrılmış doğrulamada iyileşme görüldü; öğrenilmiş ağırlıklar etkin." : `Ağırlıklar ${MODEL_MIN_RACES} yarış ve ayrılmış doğrulama iyileşmesi şartıyla güncellenir.`}`;
  } catch {
    if (status) status.textContent = "Neon yarış arşivine şu an ulaşılamadı. Bu cihazdaki kayıtlar korunuyor; bağlantı kurulduğunda arşiv yeniden kontrol edilir.";
  }
}
function compareResults() {
  const target = $("ogrenmeLogAlani");
  const parsed = parseRaces($("sonucluBultenInput").value.trim());
  if (!parsed.races.length) { showMessage(target, parsed.warnings.join(" ") || "Sonuç metni ekleyin.", "error"); return; }
  if (!lastAnalysis.length) { showMessage(target, "Önce aynı yarış gününün tahmin bültenini analiz edin; sonra sonuçları karşılaştırın.", "error"); return; }
  const timestamp = new Date().toISOString();
  const outcomes = [];
  for (const race of parsed.races) {
    const winner = race.horses.find((horse) => horse.place === 1);
    const prediction = lastAnalysis.find((item) => item.no === race.no);
    if (!winner || !prediction) continue;
    const top3 = prediction.horses.slice(0, 3);
    const marketFavorite = prediction.horses.filter((horse) => horse.marketScore !== null).sort((a, b) => b.marketScore - a.marketScore)[0];
    const winnerPrediction = prediction.horses.find((horse) => horse.number === winner.number);
    const singleGap = prediction.horses.length > 1 ? prediction.horses[0].score - prediction.horses[1].score : 0;
    const singleCandidate = singleGap >= SINGLE_GAP_THRESHOLD && prediction.horses[0].independentCoverage >= 50;
    outcomes.push({
      raceNo: race.no,
      winner: winner.number,
      winnerName: winner.name,
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
      at: timestamp
    });
  }
  if (!outcomes.length) { showMessage(target, "Eşleşen koşularda (1) birinci bilgisi bulunamadı. Tahmin ve sonuç metinlerinin aynı koşulara ait olduğunu doğrulayın.", "error"); return; }
  const known = new Set(state.outcomes.map(outcomeKey));
  const fresh = outcomes.filter((item) => !known.has(outcomeKey(item)));
  state.outcomes.push(...fresh);
  if (fresh.length) trainModel();
  saveState();
  const top3Hits = outcomes.filter((item) => item.top3Hit).length;
  const top1Hits = outcomes.filter((item) => item.top1Hit).length;
  const favoriteErrors = outcomes.filter((item) => item.favoriteMiss === true).length;
  const surpriseHits = outcomes.filter((item) => item.surpriseHit).length;
  target.innerHTML = `<div class="alert success"><b>${outcomes.length} koşu karşılaştırıldı.</b> İlk 3 içinde birinci: ${top3Hits}/${outcomes.length} (%${Math.round(top3Hits / outcomes.length * 100)}); model lideri: ${top1Hits}/${outcomes.length} (%${Math.round(top1Hits / outcomes.length * 100)}); piyasa favorisi yanılgısı: ${favoriteErrors}/${outcomes.length}; sürpriz sinyalinin kazananı yakalaması: ${surpriseHits}/${outcomes.length}.${fresh.length === 0 ? " Bu sonuçlar daha önce kaydedilmiş; özet tekrar hesaplandı." : ""}</div>${outcomes.map((item) => `<div class="alert">${item.raceNo}. koşu · Kazanan #${item.winner} ${escapeHtml(item.winnerName)} · İlk üç ${item.top3Hit ? "isabet" : "isabet değil"} · Model lideri ${item.top1Hit ? "isabet" : "isabet değil"} · Favori yanılgısı ${item.favoriteMiss === null ? "ölçülemedi" : item.favoriteMiss ? "var" : "yok"}</div>`).join("")}`;
  updateMemory();
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
    legs: coupon.picks.map((pick) => ({ raceNo: pick.no, horses: pick.ranked.slice(0, pick.count).map((horse) => ({ number: horse.number, name: horse.name, modelShare: horse.modelShare })) })),
    finishedNos: coupon.finishedNos || [],
    createdAt: new Date().toISOString()
  };
  state.coupons.unshift(record);
  state.coupons = state.coupons.slice(0, 500);
  saveState();
  showMessage($("ogrenmeLogAlani"), `${poolKey === "first" ? "Birinci" : "İkinci"} altılı kuponu sonuç takibine eklendi. Sonucu ve ödeme tutarını daha sonra ayrıca kaydedebilirsiniz.`, "success");
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
function updateCouponResult(id, card) {
  const record = state.coupons.find((coupon) => coupon.id === id);
  const status = card.querySelector("[data-coupon-status]")?.value;
  const payoutValue = card.querySelector("[data-coupon-payout]")?.value;
  const payout = payoutValue === "" ? null : parseNumber(payoutValue);
  if (!record || !Object.hasOwn(COUPON_STATUS_LABELS, status) || (status !== "pending" && (!Number.isFinite(payout) || payout < 0))) {
    showMessage($("ogrenmeLogAlani"), "Sonucu bekleyen olarak bırakın veya geçerli bir ödeme tutarı girin.", "error");
    return;
  }
  record.status = status;
  record.payout = status === "pending" ? null : payout;
  record.resolvedAt = status === "pending" ? null : new Date().toISOString();
  saveState();
  showMessage($("ogrenmeLogAlani"), "Kupon sonucu kaydedildi. Bu kayıt model ağırlıklarını değiştirmez.", "success");
}
function renderCouponHistory() {
  const target = $("couponHistoryArea");
  const metrics = $("couponMetrics");
  if (!target || !metrics) return;
  const records = Array.isArray(state.coupons) ? state.coupons : [];
  const resolved = records.filter((record) => record.status !== "pending" && Number.isFinite(Number(record.payout)));
  const cost = resolved.reduce((sum, record) => sum + Number(record.cost || 0), 0);
  const payout = resolved.reduce((sum, record) => sum + Number(record.payout || 0), 0);
  const net = payout - cost;
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
    metric("Kaydedilen kupon", records.length.toLocaleString("tr-TR")),
    metric("Sonucu girilen", resolved.length.toLocaleString("tr-TR")),
    metric("Toplam maliyet", money(cost)),
    metric("Net ödeme farkı", resolved.length ? money(net) : "—")
  );
  if (!records.length) {
    target.innerHTML = '<p class="muted">Henüz kupon kaydı yok. Analizden üretilen kuponu kaydedin veya harici kuponun sonucunu ekleyin.</p>';
    return;
  }
  target.innerHTML = records.map((record) => {
    const pool = record.poolType === "second" ? "İkinci altılı" : "Birinci altılı";
    const date = escapeHtml(record.date || "Tarih yok");
    const venue = record.city ? ` · ${escapeHtml(record.city)}` : "";
    const ticket = record.columns ? `${record.columns} kolon · ${money(record.cost)}` : `Maliyet ${money(record.cost)} · seçim dökümü yok`;
    const paid = Number.isFinite(Number(record.payout)) && record.status !== "pending" ? money(record.payout) : "bekleniyor";
    const netValue = Number(record.payout) - Number(record.cost);
    const netText = record.status !== "pending" ? `<p>Net: <span class="coupon-net${netValue < 0 ? " negative" : ""}">${money(netValue)}</span></p>` : "";
    const legs = Array.isArray(record.legs) && record.legs.length ? `<p>Seçimler: ${record.legs.map((leg) => `${leg.raceNo}. ayak #${leg.horses.map((horse) => horse.number).join(", #")}`).join(" · ")}</p>` : "";
    const finished = Array.isArray(record.finishedNos) && record.finishedNos.length ? `<p>Sonucu alınmış ayaklar: ${record.finishedNos.join(", ")}. Kupon anlık olarak açık ayaklar üzerinden oluşturulmuş; önceki kuponun geriye dönük kopyası değildir.</p>` : "";
    return `<article class="coupon-record" data-coupon-card="${escapeHtml(record.id)}"><h3>${pool} · ${date}${venue}</h3><p>${escapeHtml(record.source || "Kupon")} · ${ticket}</p>${legs}${finished}<p>Durum: ${escapeHtml(COUPON_STATUS_LABELS[record.status] || "Sonuç bekleniyor")} · Ödeme: ${paid}</p>${netText}<div class="controls"><label class="control"><small>Sonuç durumu</small><select data-coupon-status aria-label="${pool} ${date} sonuç durumu">${Object.entries(COUPON_STATUS_LABELS).map(([value, label]) => `<option value="${value}"${record.status === value ? " selected" : ""}>${label}</option>`).join("")}</select></label><label class="control"><small>Alınan ödeme (TL)</small><input data-coupon-payout type="number" min="0" step="0.01" value="${record.payout ?? ""}" placeholder="Sonuç bekleniyorsa boş bırakın" aria-label="${pool} ${date} alınan ödeme"></label><button class="btn secondary" type="button" data-update-coupon="${escapeHtml(record.id)}">Sonucu kaydet</button></div></article>`;
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
  $("modelBadge").textContent = `${ROBOT_STRATEGIES.length} deterministik robot · v${state.version}`;
  $("statsArea").innerHTML = n
    ? `<div class="stats"><div class="stat"><b>${n}</b><span>ölçülen koşu</span></div><div class="stat"><b>%${Math.round(top3 / n * 100)}</b><span>ilk 3 isabet oranı</span></div><div class="stat"><b>%${Math.round(top1 / n * 100)}</b><span>model lideri</span></div></div><div class="meter" aria-label="İlk üç isabet oranı"><span style="width:${Math.round(top3 / n * 100)}%"></span></div><p class="hint">Kişisel karşılaştırmalar (girişte Firebase hesabıyla eşitlenir) ve Neon resmi yarış arşivi birlikte değerlendirilir. ${trainable < MODEL_MIN_RACES ? `Ağırlık kalibrasyonu için ${MODEL_MIN_RACES} uygun yarış gerekir; şu an ${trainable} var.` : report?.updated ? `Ağırlıklar geçmiş veride eğitildi ve ayrılmış doğrulama grubunda iyileşme gösterdi (Brier ${report.validationBrier.toFixed(3)}).` : "Yeterli örnek var; fakat doğrulama grubu mevcut ağırlıkları geçemedi, bu yüzden model ağırlıkları değiştirilmedi."} Güçlü tek aday geçmişi: ${singleHits}/${singleResults.length}; doğrulanmış pist/koşu türü ağırlığı: ${contextCount}. Oranlar gelecekte kazanma garantisi değildir.</p>`
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
  $("learnBtn")?.addEventListener("click", compareResults);
  $("learnButton")?.addEventListener("click", compareResults);
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
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  syncHistoricalArchive();
});
