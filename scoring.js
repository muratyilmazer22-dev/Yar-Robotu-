(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.RaceScoring = engine;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const DEFAULT_DNA = {
    DIESIS: { B: 2, I: 4, C: 10, S: 4, P: 0 },
    SINGSPIEL: { B: 0, I: 2, C: 8, S: 8, P: 2 },
    VICTORYGALLOP: { B: 4, I: 6, C: 12, S: 4, P: 0 },
    NATIVEKHAN: { B: 2, I: 4, C: 8, S: 2, P: 0 },
    LUXOR: { B: 6, I: 6, C: 4, S: 0, P: 0 },
    KANEKO: { B: 4, I: 8, C: 6, S: 0, P: 0 },
    MENDIP: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    TOROK: { B: 6, I: 6, C: 4, S: 0, P: 0 },
    LIONHEART: { B: 8, I: 4, C: 4, S: 0, P: 0 },
    SRIPAD: { B: 4, I: 6, C: 6, S: 2, P: 0 },
    KURTINIADIS: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    TURBO: { B: 6, I: 6, C: 4, S: 0, P: 0 },
    KAIZBERT: { B: 8, I: 6, C: 2, S: 0, P: 0 },
    OZGUNHAN: { B: 2, I: 4, C: 8, S: 4, P: 0 },
    FLIGHTLINE: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    GUNRUNNER: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    TAPIT: { B: 2, I: 4, C: 10, S: 4, P: 0 },
    MUNNINGS: { B: 8, I: 4, C: 2, S: 0, P: 0 },
    PRACTICALJOKE: { B: 6, I: 6, C: 4, S: 0, P: 0 },
    INVINCIBLESPIRIT: { B: 8, I: 4, C: 2, S: 0, P: 0 },
    CAIROPRINCE: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    GOODMAGIC: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    SMILINGTIGER: { B: 8, I: 4, C: 2, S: 0, P: 0 },
    MALIBUMOON: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    DISTORTEDHUMOR: { B: 6, I: 6, C: 4, S: 0, P: 0 }
  };

  function normalizeName(value) {
    return String(value || '').toLocaleUpperCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, '').trim();
  }

  function distanceBand(distance) {
    const value = Number(distance);
    if (!Number.isFinite(value) || value <= 0) return 'mesafe-belirsiz';
    if (value <= 1300) return 'kisa';
    if (value < 1800) return 'orta';
    return 'uzun';
  }

  function raceContextKeys(race) {
    const surface = String(race?.surface || '').trim();
    const type = String(race?.type || '').trim();
    const broad = `${surface}|${type}`;
    const city = String(race?.city || '').trim().toLocaleUpperCase('tr-TR');
    const country = String(race?.country || race?.countryCode || '').trim().toLocaleUpperCase('tr-TR');
    const venueConfig = String(race?.venueConfig || race?.courseConfig || race?.trackConfiguration || '').trim().toLocaleUpperCase('tr-TR');
    const band = distanceBand(race?.distance);
    const keys = [`${broad}|${band}`, broad];
    if (country) keys.unshift(`${country}|${broad}|${band}`, `${country}|${broad}`);
    if (city) keys.unshift(`${city}|${broad}|${band}`, `${city}|${broad}`);
    if (country && city) keys.unshift(`${country}|${city}|${broad}|${band}`, `${country}|${city}|${broad}`);
    if (venueConfig) keys.unshift(`${city || country || 'VENUE'}|${venueConfig}|${broad}|${band}`, `${city || country || 'VENUE'}|${venueConfig}|${broad}`);
    return [...new Set(keys)];
  }

  const BASE_WEIGHTS = { rating: 0.24, form: 0.22, market: 0.19, pedigree: 0.11, groupFit: 0.05, classHistory: 0.08, timeFit: 0.06, rivalFit: 0.025, venueFit: 0.05, weatherFit: 0.03, trackFit: 0.04, jockeyFit: 0.025, distanceFit: 0.02, restFit: 0.015, weightFit: 0.015, analystFit: 0.04 };
  const FEATURE_LABELS = {
    rating: "HP", form: "Son form", market: "AGF/oran", pedigree: "Pedigri", groupFit: "Grup gücü",
    classHistory: "Sınıf geçmişi", timeFit: "Derece", rivalFit: "Rakip geçmişi", venueFit: "Hipodrom",
    weatherFit: "Hava", trackFit: "Pist", jockeyFit: "Jokey", distanceFit: "Mesafe",
    restFit: "Dinlenme aralığı", weightFit: "Kilo", analystFit: "Uzman yorumu"
  };

  function weightedFeatureScore(features, weights, referenceWeights = weights, marketAgreement = null) {
    const effectiveWeights = { ...weights };
    if (Number.isFinite(marketAgreement)) effectiveWeights.market = Number(weights.market || 0) * Math.max(0.15, marketAgreement / 100);
    const available = Object.entries(features || {}).filter(([key, value]) => Number.isFinite(value) && Number(effectiveWeights[key]) > 0);
    const availableWeight = available.reduce((sum, [key]) => sum + Number(effectiveWeights[key]), 0);
    const referenceWeight = Object.values(referenceWeights || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    const rawScore = availableWeight
      ? available.reduce((sum, [key, value]) => sum + value * Number(effectiveWeights[key]), 0) / availableWeight
      : 50;
    const coverage = referenceWeight ? Math.min(1, availableWeight / referenceWeight) : 0;
    const score = 50 + (rawScore - 50) * Math.sqrt(coverage);
    return { score, rawScore, coverage: coverage * 100, availableWeight, referenceWeight };
  }

  function weightedFeatureScoreGradient(features, weights, marketAgreement = null) {
    const referenceWeight = Object.values(weights || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
    const marketFactor = Number.isFinite(marketAgreement) ? Math.max(0.15, marketAgreement / 100) : 1;
    const available = Object.entries(features || {}).filter(([key, value]) => {
      const weight = Number(weights?.[key]);
      const effectiveWeight = weight * (key === 'market' ? marketFactor : 1);
      return Number.isFinite(value) && Number.isFinite(effectiveWeight) && effectiveWeight > 0;
    }).map(([key, value]) => ({
      key,
      value,
      factor: key === 'market' ? marketFactor : 1,
      effectiveWeight: Number(weights[key]) * (key === 'market' ? marketFactor : 1)
    }));
    const availableWeight = available.reduce((sum, item) => sum + item.effectiveWeight, 0);
    if (!availableWeight || !referenceWeight) return Object.fromEntries(Object.keys(weights || {}).map((key) => [key, 0]));

    const rawScore = available.reduce((sum, item) => sum + item.value * item.effectiveWeight, 0) / availableWeight;
    const coverage = Math.min(1, availableWeight / referenceWeight);
    if (!(coverage > 0)) return Object.fromEntries(Object.keys(weights || {}).map((key) => [key, 0]));

    const present = new Map(available.map((item) => [item.key, item]));
    return Object.fromEntries(Object.keys(weights || {}).map((key) => {
      const item = present.get(key);
      const effectiveFactor = item?.factor || 0;
      const rawDerivative = item ? effectiveFactor * (item.value - rawScore) / availableWeight : 0;
      const coverageDerivative = coverage < 1 && referenceWeight > 0
        ? (effectiveFactor * referenceWeight - availableWeight) / (referenceWeight * referenceWeight)
        : 0;
      const scoreDerivative = Math.sqrt(coverage) * rawDerivative
        + (rawScore - 50) * coverageDerivative / (2 * Math.sqrt(coverage));
      return [key, Number.isFinite(scoreDerivative) ? scoreDerivative : 0];
    }));
  }

  function softmaxScores(horses, weights) {
    const scores = horses.map((horse) => weightedFeatureScore(horse.features, weights, weights, horse.marketAgreement).score);
    const logits = scores.map((score) => score / 12.5);
    const maximum = Math.max(...logits);
    const exponentials = logits.map((value) => Math.exp(value - maximum));
    const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
    return exponentials.map((value) => value / total);
  }

  function scoreRaceWithWeights(race, weights, profileScoreFn) {
    const active = (Array.isArray(race?.horses) ? race.horses : []).filter((horse) => !horse.scratched).map((horse) => ({
      ...horse,
      number: (() => {
        const value = horse.number ?? horse.horseNumber ?? horse.no;
        const parsed = value === null || value === undefined || value === "" ? null : Number(value);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
      })(),
      hp: Number(horse.hp ?? horse.handicapPoints) || null,
      agf: Number(horse.agf) || null,
      odds: Number(horse.odds) || null,
      last6: String(horse.last6 ?? horse.form ?? "")
    }));
    if (!active.length) return [];
    const timePaces = active.map((horse) => Number(horse.timePace)).filter((pace) => Number.isFinite(pace) && pace > 0).sort((a, b) => a - b);
    const middlePace = Math.floor(timePaces.length / 2);
    const medianTimePace = timePaces.length >= 2
      ? timePaces.length % 2 ? timePaces[middlePace] : (timePaces[middlePace - 1] + timePaces[middlePace]) / 2
      : null;
    const maxHp = Math.max(1, ...active.map((horse) => horse.hp || 0));
    const maxAgf = Math.max(1, ...active.map((horse) => horse.agf || 0));
    const validOdds = active.map((horse) => horse.odds).filter((odds) => odds > 0);
    const favoriteOdds = Math.min(...validOdds);
    const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 1;
    const ranked = active.map((horse) => {
      const recent = horse.last6 ? [...horse.last6].slice(0, 6).map(Number).filter((value) => value >= 1 && value <= 9) : [];
      const getProfileScore = profileScoreFn || ((name, distance) => {
        const profile = DEFAULT_DNA[normalizeName(name)];
        if (!profile) return null;
        const values = [profile.B, profile.I, profile.C, profile.S, profile.P].map((value) => Number(value) || 0);
        const total = values.reduce((sum, value) => sum + value, 0);
        if (!total) return null;
        const [speed, intermediate, classic, stamina, staminaPlus] = values;
        const speedFit = (speed + intermediate) / total;
        const staminaFit = (stamina + staminaPlus) / total;
        const middleFit = (classic + intermediate) / total;
        if (!Number.isFinite(Number(distance)) || Number(distance) <= 0) return null;
        return 45 + 55 * (distance <= 1300 ? speedFit : distance >= 1800 ? staminaFit : middleFit);
      });
      const sire = horse.sire ? getProfileScore(horse.sire, race.distance) : null;
      const dam = horse.dam ? getProfileScore(horse.dam, race.distance) : null;
      const damSire = horse.damSire ? getProfileScore(horse.damSire, race.distance) : null;
      const learnedPedigree = horse.pedigreeFit !== null && horse.pedigreeFit !== undefined && Number.isFinite(Number(horse.pedigreeFit)) ? Number(horse.pedigreeFit) : null;
      const profileLines = [[sire, 0.45], [dam, 0.3], [damSire, 0.25]].filter(([value]) => value !== null);
      const profilePedigree = profileLines.length
        ? profileLines.reduce((sum, [value, weight]) => sum + value * weight, 0) / profileLines.reduce((sum, [, weight]) => sum + weight, 0)
        : null;
      const pedigreeSource = learnedPedigree !== null ? "Arşiv soy hattı" : profilePedigree !== null ? "Genel soy profili" : "Veri yok";
      const agfScore = horse.agf > 0 ? horse.agf / maxAgf * 100 : null;
      const oddsScore = horse.odds > 0 && Number.isFinite(favoriteOdds) ? favoriteOdds / horse.odds * 100 : null;
      const market = agfScore !== null && oddsScore !== null ? agfScore * 0.65 + oddsScore * 0.35 : agfScore ?? oddsScore;
      const marketAgreement = agfScore !== null && oddsScore !== null ? Math.max(0, 100 - Math.abs(agfScore - oddsScore)) : null;
      const features = {
        rating: horse.hp ? horse.hp / maxHp * 100 : null,
        form: recent.length ? recent.reduce((sum, place) => sum + (10 - place), 0) / recent.length * 10 : null,
        market,
        pedigree: learnedPedigree ?? profilePedigree,
        groupFit: horse.groupFit !== null && horse.groupFit !== undefined && Number.isFinite(Number(horse.groupFit)) ? Number(horse.groupFit) : null,
        rivalFit: horse.rivalFit !== null && horse.rivalFit !== undefined && Number.isFinite(Number(horse.rivalFit)) ? Number(horse.rivalFit) : null,
        timeFit: Number.isFinite(Number(horse.timePace)) && Number(horse.timePace) > 0 && medianTimePace !== null
          ? Math.max(0, Math.min(100, Math.round((50 + (medianTimePace - Number(horse.timePace)) / medianTimePace * 400) * 10) / 10))
          : null,
        classHistory: horse.classHistoryScore !== null && horse.classHistoryScore !== undefined && Number.isFinite(Number(horse.classHistoryScore)) ? Number(horse.classHistoryScore) : null,
        venueFit: horse.venueFit !== null && horse.venueFit !== undefined && Number.isFinite(Number(horse.venueFit)) ? Number(horse.venueFit) : null,
        weatherFit: horse.weatherFit !== null && horse.weatherFit !== undefined && Number.isFinite(Number(horse.weatherFit)) ? Number(horse.weatherFit) : null,
        trackFit: horse.trackFit !== null && horse.trackFit !== undefined && Number.isFinite(Number(horse.trackFit)) ? Number(horse.trackFit) : null,
        jockeyFit: horse.jockeyFit !== null && horse.jockeyFit !== undefined && Number.isFinite(Number(horse.jockeyFit)) ? Number(horse.jockeyFit) : null,
        distanceFit: horse.distanceFit !== null && horse.distanceFit !== undefined && Number.isFinite(Number(horse.distanceFit)) ? Number(horse.distanceFit) : null,
        restFit: horse.daysSinceLastRace !== null && horse.daysSinceLastRace !== undefined && horse.daysSinceLastRace !== "" && Number.isFinite(Number(horse.daysSinceLastRace)) && Number(horse.daysSinceLastRace) >= 0
          ? Math.max(20, Math.min(100, 100 - Math.abs(Number(horse.daysSinceLastRace) - 28) * 1.4))
          : horse.restFit !== null && horse.restFit !== undefined && Number.isFinite(Number(horse.restFit))
            ? Number(horse.restFit)
            : null,
        analystFit: horse.analystFit !== null && horse.analystFit !== undefined && Number.isFinite(Number(horse.analystFit)) ? Number(horse.analystFit) : null,
        weightFit: horse.weightFit !== null && horse.weightFit !== undefined && Number.isFinite(Number(horse.weightFit)) ? Number(horse.weightFit) : null
      };
      const scoreResult = weightedFeatureScore(features, weights, weights, marketAgreement);
      const independentKeys = Object.keys(weights).filter((key) => key !== "market" && Number.isFinite(features[key]) && Number(weights[key]) > 0);
      const independentWeight = independentKeys.reduce((sum, key) => sum + Number(weights[key]), 0);
      const performanceScore = independentWeight ? independentKeys.reduce((sum, key) => sum + features[key] * Number(weights[key]), 0) / independentWeight : null;
      const independentCoverage = Math.round(Math.min(1, independentWeight / Math.max(0.01, totalWeight - Number(weights.market || 0))) * 100);
      const missingSignals = Object.keys(weights).filter((key) => !Number.isFinite(features[key])).map((key) => FEATURE_LABELS[key] || key);
      const marketConflict = marketAgreement !== null && marketAgreement < 40;
      const coverage = Math.round(scoreResult.coverage);
      let confidence = coverage >= 70 && independentCoverage >= 60
        ? "Yüksek"
        : coverage >= 50 && independentCoverage >= 35
          ? "Orta"
          : "Düşük";
      if (marketConflict) confidence = confidence === "Yüksek" ? "Orta" : "Düşük";
      const rawScore = scoreResult.rawScore;
      const score = scoreResult.score;
      const signal = independentKeys.length < 2 || independentCoverage < 35 || coverage < 40 || performanceScore === null || features.market === null
        ? "Veri yetersiz"
        : performanceScore - features.market >= 12
          ? "Sürpriz adayı"
          : features.market - performanceScore >= 15
            ? "Favori riski"
            : "Sinyaller uyumlu";
      return { ...horse, score: Math.round(score * 10) / 10, rawScore: Math.round(rawScore * 10) / 10, features, pedigreeSource, performanceScore, marketScore: features.market, marketAgreement, marketConflict, missingSignals, coverage, independentCoverage, confidence, signal };
    });
    const shares = softmaxScores(ranked, weights);
    return ranked.map((horse, index) => ({ ...horse, modelShare: shares[index] })).sort((a, b) => b.modelShare - a.modelShare);
  }

  function analyzeRace(race, options = {}) {
    const contextKeys = raceContextKeys(race);
    const contextualWeights = contextKeys.map((key) => options.contextWeights?.[key]).find(Boolean) || {};
    const weights = { ...BASE_WEIGHTS, ...(options.modelWeights || {}), ...contextualWeights };
    const scored = scoreRaceWithWeights(race, weights, options.profileScore);
    const shares = softmaxScores(scored, weights);
    const rankForScenario = (scenarioWeights) => new Map([...scored]
      .sort((a, b) => weightedFeatureScore(b.features, scenarioWeights, scenarioWeights, b.marketAgreement).score
        - weightedFeatureScore(a.features, scenarioWeights, scenarioWeights, a.marketAgreement).score)
      .map((horse, index) => [horse, index + 1]));
    const baselineRanks = rankForScenario(BASE_WEIGHTS);
    const noMarketRanks = rankForScenario({ ...weights, market: 0 });
    const marketRanks = new Map(scored
      .filter((horse) => Number.isFinite(horse.marketScore))
      .sort((a, b) => b.marketScore - a.marketScore)
      .map((horse, index) => [horse, index + 1]));

    return scored.map((horse, index) => {
      const baseRank = baselineRanks.get(horse) || index + 1;
      const withoutMarketRank = noMarketRanks.get(horse) || index + 1;
      const marketRank = marketRanks.get(horse) || null;
      const marketLift = withoutMarketRank > index + 1;
      const rankShift = Math.max(Math.abs(index + 1 - baseRank), Math.abs(index + 1 - withoutMarketRank));
      const drivers = Object.entries(horse.features)
        .filter(([key, value]) => Number.isFinite(value) && Number(weights[key]) > 0)
        .map(([key, value]) => {
          const marketFactor = key === 'market' && Number.isFinite(horse.marketAgreement)
            ? Math.max(0.15, horse.marketAgreement / 100)
            : 1;
          return { key, label: FEATURE_LABELS[key] || key, value, impact: (value - 50) * Number(weights[key]) * marketFactor };
        });
      const positiveDrivers = drivers.filter((driver) => driver.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, 3);
      const counterSignals = drivers.filter((driver) => driver.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, 3);
      const riskFlags = [];
      if (horse.independentCoverage < 35) riskFlags.push('Piyasa dışı bağımsız kanıt sınırlı.');
      if (horse.coverage < 50) riskFlags.push('Toplam veri kapsamı düşük; skor daha belirsiz.');
      if (horse.marketConflict) riskFlags.push('AGF ile oran ayrışıyor; piyasa etkisi azaltıldı.');
      if (marketLift) riskFlags.push(`Piyasa etkisi toplam sıralamayı öne taşıyor; piyasa hariç model sırası #${withoutMarketRank}.`);
      if (marketRank !== null && Math.abs(marketRank - withoutMarketRank) >= 2) riskFlags.push(`Piyasa sırası #${marketRank} ile piyasa hariç model sırası #${withoutMarketRank} ayrışıyor; favori/sürpriz riski izlenmeli.`);
      if (rankShift >= 2) riskFlags.push(`Ağırlık/piyasa duyarlılık testinde sıra ${rankShift} basamağa kadar değişiyor.`);
      if (horse.missingSignals.length) riskFlags.push(`Eksik sinyaller: ${horse.missingSignals.join(', ')}.`);
      const confidence = marketLift && horse.independentCoverage < 60 ? 'Düşük' : horse.confidence;
      const summary = [
        positiveDrivers.length ? `Olumlu sürücüler: ${positiveDrivers.map((driver) => driver.label).join(', ')}.` : '50 nötr çizgisinin üzerinde güçlü bir model sinyali yok.',
        counterSignals.length ? `Karşı sinyaller: ${counterSignals.map((driver) => driver.label).join(', ')}.` : 'Mevcut veride belirgin negatif model sinyali yok.'
      ].join(' ');
      return {
        ...horse,
        confidence,
        marketRank,
        marketLift,
        modelShare: shares[index],
        reasoning: {
          summary,
          positiveDrivers,
          counterSignals,
          riskFlags,
          rankStability: Math.max(0, 100 - rankShift * 25),
          baseRank,
          withoutMarketRank,
          marketRank,
          marketLift,
          rankShift
        }
      };
    }).sort((a, b) => b.modelShare - a.modelShare);
  }

  return { DEFAULT_DNA, BASE_WEIGHTS, normalizeName, distanceBand, raceContextKeys, weightedFeatureScore, weightedFeatureScoreGradient, softmaxScores, analyzeRace };
});
