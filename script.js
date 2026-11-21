const STORAGE_KEY = "race-analysis-v1";
const DEFAULT_STATE = { version: 1, profiles: {}, predictions: [], outcomes: [] };
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

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return { ...DEFAULT_STATE, ...(saved && typeof saved === "object" ? saved : {}), profiles: { ...DEFAULT_PROFILES, ...(saved?.profiles || {}) } };
  } catch { return { ...DEFAULT_STATE, profiles: { ...DEFAULT_PROFILES } }; }
}
let state = loadState();
let lastAnalysis = [];
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { showMessage($("ogrenmeLogAlani"), "Tarayıcı depolaması kullanılamıyor; bu oturumdaki bilgiler kalıcı olmayabilir.", "error"); } updateMemory(); }
function showMessage(target, text, type = "") { target.innerHTML = `<div class="alert ${type}">${escapeHtml(text)}</div>`; }
function setTab(name) {
  document.querySelectorAll(".tab").forEach((button) => { const active = button.dataset.tab === name; button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1; });
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
      const distance = detail.match(/(\d{3,4})\s*(Kum|Çim|Sentetik)/i);
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
  const filtered = races.filter((item) => item.horses.length > 0);
  if (!filtered.length) warnings.push("Koşu ve at satırı bulunamadı. TJK metnini sekme ayrımları korunacak şekilde yeniden kopyalayın.");
  for (const item of races) if (!item.horses.length) warnings.push(`${item.no}. koşuda okunabilir at satırı bulunamadı.`);
  return { races: filtered, warnings };
}
function profileScore(name, distance) {
  const profile = state.profiles[normalize(name).replace(/[^A-Z0-9]/g, "")];
  if (!Array.isArray(profile)) return 50;
  const [speed, intermediate, classic, stamina, staminaPlus] = profile.map(Number);
  const total = speed + intermediate + classic + stamina + staminaPlus || 1;
  const speedFit = (speed + intermediate) / total;
  const staminaFit = (stamina + staminaPlus) / total;
  const middleFit = (classic + intermediate) / total;
  return 45 + 55 * (distance <= 1300 ? speedFit : distance >= 1800 ? staminaFit : middleFit);
}
function scoreRace(race) {
  const active = race.horses.filter((horse) => !horse.scratched);
  const maxHp = Math.max(1, ...active.map((horse) => horse.hp || 0));
  const maxAgf = Math.max(1, ...active.map((horse) => horse.agf || 0));
  return active.map((horse) => {
    const recent = horse.last6 ? [...horse.last6].slice(0, 6).map(Number).filter((n) => n >= 1 && n <= 9) : [];
    const form = recent.length ? recent.reduce((sum, place) => sum + (10 - place), 0) / recent.length * 10 : 50;
    const rating = horse.hp ? horse.hp / maxHp * 100 : 50;
    const market = horse.agf ? horse.agf / maxAgf * 100 : 45;
    const pedigree = (profileScore(horse.sire, race.distance) * 0.65) + (profileScore(horse.damSire, race.distance) * 0.35);
    const score = rating * 0.30 + form * 0.30 + market * 0.25 + pedigree * 0.15;
    return { ...horse, score: Math.round(score * 10) / 10 };
  }).sort((a, b) => b.score - a.score);
}
function renderAnalysis(races, targetId = "kosuSonucAlani") {
  const target = $(targetId);
  target.innerHTML = races.map((race) => {
    const ranked = scoreRace(race);
    return `<article class="race"><h3>${race.no}. Koşu${race.time ? ` · ${escapeHtml(race.time)}` : ""} · ${escapeHtml(race.distance)} m ${escapeHtml(race.surface)} <span class="muted">· ${escapeHtml(race.type)}</span></h3>${ranked.length ? ranked.map((horse, index) => `<div class="horse"><strong>#${horse.number}</strong><span>${escapeHtml(horse.name)}${index === 0 ? " <small>· puan lideri</small>" : ""}</span><span class="score">${horse.score.toFixed(1)}</span><small>${horse.agf === null ? "AGF yok" : `AGF %${horse.agf}`}${horse.hp === null ? " · HP yok" : ` · HP ${horse.hp}`}</small></div>`).join("") : "<p class=muted>Koşabilir at bulunamadı.</p>"}</article>`;
  }).join("");
}
function buildCoupon(races, budget, unit) {
  const six = races.slice(0, 6).map((race) => ({ race, ranked: scoreRace(race) }));
  if (six.length !== 6) return { error: "Altılı kupon için en az 6 okunabilir koşu gerekir." };
  if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(unit) || unit <= 0) return { error: "Bütçe ve kolon fiyatı sıfırdan büyük olmalıdır." };
  const maxColumns = Math.floor(budget / unit);
  if (maxColumns < 1) return { error: "Bütçe, en az bir kolonun birim fiyatını karşılamıyor." };
  const picks = six.map(({ race, ranked }) => ({ no: race.no, ranked, count: 1 }));
  const combinations = () => picks.reduce((product, pick) => product * pick.count, 1);
  while (true) {
    let best = null;
    for (const pick of picks) {
      if (pick.count >= pick.ranked.length) continue;
      const next = combinations() * (pick.count + 1) / pick.count;
      if (next <= maxColumns && (!best || (pick.ranked[pick.count - 1].score - pick.ranked[pick.count].score) < best.gap)) best = { pick, gap: pick.ranked[pick.count - 1].score - pick.ranked[pick.count].score };
    }
    if (!best) break;
    best.pick.count++;
  }
  const columns = combinations();
  return { picks, columns, total: Math.round(columns * unit * 100) / 100, budget };
}
function analyze() {
  const input = $("hamBultenInput").value.trim();
  const warning = $("bultenUyariAlani");
  warning.innerHTML = "";
  $("dogrulamaRaporuAlani").innerHTML = "";
  $("kuponAlani").innerHTML = "";
  $("kosuSonucAlani").innerHTML = "";
  if (!input) { showMessage(warning, "Önce TJK bülten metnini yapıştırın.", "error"); return; }
  const parsed = parseRaces(input);
  if (!parsed.races.length) { showMessage(warning, parsed.warnings.join(" "), "error"); return; }
  lastAnalysis = parsed.races.map((race) => ({ no: race.no, horses: scoreRace(race).map((horse) => ({ number: horse.number, name: horse.name, score: horse.score })) }));
  state.predictions = lastAnalysis;
  saveState();
  renderAnalysis(parsed.races);
  if (parsed.warnings.length) showMessage(warning, parsed.warnings.join(" "), "");
  else showMessage(warning, `${parsed.races.length} koşu ve ${parsed.races.reduce((n, race) => n + race.horses.length, 0)} at okundu. Puanlar sıralama göstergesidir; kazanma olasılığı veya garanti değildir.`, "success");
  const budget = parseNumber($("butceInput").value);
  const unit = parseNumber($("birimInput").value);
  const coupon = buildCoupon(parsed.races, budget, unit);
  if (coupon.error) showMessage($("kuponAlani"), coupon.error, "error");
  else $("kuponAlani").innerHTML = `<div class="card"><h2>Altılı bütçe dağılımı</h2><p class="hint">Bu kupon bir tahmindir; performans garantisi değildir.</p>${coupon.picks.map((pick) => `<div class="alert"><b>${pick.no}. Koşu · ${pick.count} at:</b> ${pick.ranked.slice(0, pick.count).map((horse) => `#${horse.number} ${escapeHtml(horse.name)}`).join(", ")}</div>`).join("")}<b>${coupon.columns} kolon · ${coupon.total.toFixed(2)} TL / ${coupon.budget.toFixed(2)} TL bütçe</b></div>`;
  setTab("analiz");
}
function compareResults() {
  const target = $("ogrenmeLogAlani");
  const parsed = parseRaces($("sonucluBultenInput").value.trim());
  if (!parsed.races.length) { showMessage(target, parsed.warnings.join(" ") || "Sonuç metni ekleyin.", "error"); return; }
  if (!lastAnalysis.length) { showMessage(target, "Önce aynı yarış gününün tahmin bültenini analiz edin; sonra sonuçları karşılaştırın.", "error"); return; }
  const outcomes = [];
  for (const race of parsed.races) {
    const winner = race.horses.find((horse) => horse.place === 1);
    const prediction = lastAnalysis.find((item) => item.no === race.no);
    if (!winner || !prediction) continue;
    const top3 = prediction.horses.slice(0, 3);
    outcomes.push({ raceNo: race.no, winner: winner.number, winnerName: winner.name, top3Hit: top3.some((horse) => horse.number === winner.number), top1Hit: top3[0]?.number === winner.number, at: new Date().toISOString() });
  }
  if (!outcomes.length) { showMessage(target, "Eşleşen koşularda (1) birinci bilgisi bulunamadı. Tahmin ve sonuç metinlerinin aynı koşulara ait olduğunu doğrulayın.", "error"); return; }
  const known = new Set(state.outcomes.map((item) => `${item.raceNo}:${item.winner}:${item.at.slice(0, 10)}`));
  const fresh = outcomes.filter((item) => !known.has(`${item.raceNo}:${item.winner}:${item.at.slice(0, 10)}`));
  state.outcomes.push(...fresh);
  saveState();
  const top3Hits = outcomes.filter((item) => item.top3Hit).length;
  const top1Hits = outcomes.filter((item) => item.top1Hit).length;
  target.innerHTML = `<div class="alert success"><b>${outcomes.length} koşu karşılaştırıldı.</b> İlk 3 içinde birinci: ${top3Hits}/${outcomes.length} (%${Math.round(top3Hits / outcomes.length * 100)}); ilk sıradaki tahmin birinci: ${top1Hits}/${outcomes.length} (%${Math.round(top1Hits / outcomes.length * 100)}).${fresh.length === 0 ? " Bu sonuçlar daha önce kaydedilmiş; özet tekrar hesaplandı." : ""}</div>${outcomes.map((item) => `<div class="alert">${item.raceNo}. koşu · Kazanan #${item.winner} ${escapeHtml(item.winnerName)} · İlk üç ${item.top3Hit ? "isabet" : "isabet değil"} · Lider ${item.top1Hit ? "isabet" : "isabet değil"}</div>`).join("")}`;
  updateMemory();
}
function updateMemory() {
  const n = state.outcomes.length;
  const top3 = state.outcomes.filter((item) => item.top3Hit).length;
  const top1 = state.outcomes.filter((item) => item.top1Hit).length;
  $("modelBadge").textContent = `Model v${state.version}`;
  $("statsArea").innerHTML = n ? `<div class="stats"><div class="stat"><b>${n}</b><span>ölçülen koşu</span></div><div class="stat"><b>%${Math.round(top3 / n * 100)}</b><span>ilk 3 isabet oranı</span></div><div class="stat"><b>%${Math.round(top1 / n * 100)}</b><span>lider isabet oranı</span></div></div><div class="meter" aria-label="İlk üç isabet oranı"><span style="width:${Math.round(top3 / n * 100)}%"></span></div><p class="hint">Yüzdeler yalnızca kaydedilmiş karşılaştırmalara aittir; küçük örneklemde genellenemez.</p>` : `<p class="muted">Henüz ölçülmüş sonuç yok. Yüzde hesaplamak için tahminleri gerçek sonuçlarla karşılaştırın.</p>`;
  const profileNames = Object.keys(state.profiles).sort();
  $("aygirListeAlani").textContent = `${profileNames.length} pedigri profili: ${profileNames.slice(0, 12).join(", ")}${profileNames.length > 12 ? "…" : ""}`;
  $("historyArea").innerHTML = n ? `<table class="table"><thead><tr><th>Koşu</th><th>Kazanan</th><th>İlk üç</th><th>Lider</th><th>Tarih</th></tr></thead><tbody>${state.outcomes.slice(-30).reverse().map((item) => `<tr><td>${item.raceNo}</td><td>#${item.winner} ${escapeHtml(item.winnerName)}</td><td>${item.top3Hit ? "Evet" : "Hayır"}</td><td>${item.top1Hit ? "Evet" : "Hayır"}</td><td>${new Date(item.at).toLocaleDateString("tr-TR")}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Karşılaştırma geçmişi henüz yok.</p>`;
}
function addProfile() {
  const name = normalize($("aygirAdInput").value).replace(/[^A-Z0-9]/g, "");
  const values = $("dpValues").value.split(/[;,\s]+/).filter(Boolean).map(parseNumber);
  if (!name || values.length !== 5 || values.some((value) => value === null || value < 0)) { showMessage($("aygirListeAlani"), "Aygır adı ve sıfır veya daha büyük 5 sayısal profil değeri girin. Örnek: 6, 6, 4, 0, 0", "error"); return; }
  state.profiles[name] = values;
  saveState();
  $("aygirAdInput").value = "";
  $("dpValues").value = "";
  showMessage($("aygirListeAlani"), `${name} profili kaydedildi.`, "success");
}
function resetHistory() {
  if (!window.confirm("Sonuç geçmişi ve eklenen profiller silinsin mi?")) return;
  state = { ...DEFAULT_STATE, profiles: { ...DEFAULT_PROFILES } };
  lastAnalysis = [];
  saveState();
  $("ogrenmeLogAlani").innerHTML = "";
  showMessage($("ogrenmeLogAlani"), "Öğrenme geçmişi varsayılanlara döndürüldü.", "success");
}
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  $("analyzeBtn").addEventListener("click", analyze);
  $("clearBtn").addEventListener("click", () => { $("hamBultenInput").value = ""; $("bultenUyariAlani").innerHTML = ""; });
  $("learnBtn").addEventListener("click", compareResults);
  $("saveHorseBtn").addEventListener("click", addProfile);
  $("resetBtn").addEventListener("click", resetHistory);
  document.querySelectorAll(".tab").forEach((button, index, buttons) => button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); buttons[next].click();
  }));
  if (state.predictions?.length) lastAnalysis = state.predictions;
  updateMemory();
});
