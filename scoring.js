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
    const surface = String(race?.surface || '');
    const type = String(race?.type || '');
    const broad = `${surface}|${type}`;
    return [`${broad}|${distanceBand(race?.distance)}`, broad];
  }

  const BASE_WEIGHTS = { rating: 0.3, form: 0.3, market: 0.25, pedigree: 0.15 };
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

  function softmaxScores(horses, weights) {
    const scores = horses.map((horse) => {
      const available = Object.entries(horse.features || {}).filter(([key, value]) => Number.isFinite(value) && weights[key] !== 0);
      const weightTotal = available.reduce((sum, [key]) => sum + weights[key], 0);
      return weightTotal ? available.reduce((sum, [key, value]) => sum + value * weights[key], 0) / weightTotal : 50;
    });
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
        return 45 + 55 * (distance <= 1300 ? speedFit : distance >= 1800 ? staminaFit : middleFit);
      });
      const sire = horse.sire ? getProfileScore(horse.sire, race.distance) : null;
      const damSire = horse.damSire ? getProfileScore(horse.damSire, race.distance) : null;
      const agfScore = horse.agf > 0 ? horse.agf / maxAgf * 100 : null;
      const oddsScore = horse.odds > 0 && Number.isFinite(favoriteOdds) ? favoriteOdds / horse.odds * 100 : null;
      const market = agfScore !== null && oddsScore !== null ? agfScore * 0.65 + oddsScore * 0.35 : agfScore ?? oddsScore;
      const features = {
        rating: horse.hp ? horse.hp / maxHp * 100 : null,
        form: recent.length ? recent.reduce((sum, place) => sum + (10 - place), 0) / recent.length * 10 : null,
        market,
        pedigree: sire !== null && damSire !== null ? sire * 0.65 + damSire * 0.35 : sire ?? damSire
      };
      const availableWeight = Object.entries(features).reduce((sum, [key, value]) => sum + (value === null || weights[key] === 0 ? 0 : weights[key]), 0);
      const score = availableWeight ? Object.entries(features).reduce((sum, [key, value]) => sum + (value === null || weights[key] === 0 ? 0 : value * weights[key]), 0) / availableWeight : null;
      const independentKeys = ["rating", "form", "pedigree"].filter((key) => features[key] !== null);
      const independentWeight = independentKeys.reduce((sum, key) => sum + weights[key], 0);
      const performanceScore = independentWeight ? independentKeys.reduce((sum, key) => sum + features[key] * weights[key], 0) / independentWeight : null;
      const independentCoverage = Math.round(independentWeight / (totalWeight - weights.market || 1) * 100);
      const coverage = Math.round(availableWeight / totalWeight * 100);
      const signal = performanceScore === null || features.market === null
        ? "Veri yetersiz"
        : performanceScore - features.market >= 12
          ? "Sürpriz adayı"
          : features.market - performanceScore >= 15
            ? "Favori riski"
            : "Sinyaller uyumlu";
      return { ...horse, score: score === null ? 50 : Math.round(score * 10) / 10, features, performanceScore, marketScore: features.market, coverage, independentCoverage, signal };
    });
    const shares = softmaxScores(ranked, weights);
    return ranked.map((horse, index) => ({ ...horse, modelShare: shares[index] })).sort((a, b) => b.modelShare - a.modelShare);
  }

  function analyzeEnsemble(race, options = {}) {
    const contextKeys = raceContextKeys(race);
    const contextualWeights = contextKeys.map((key) => options.contextWeights?.[key]).find(Boolean) || {};
    const adaptiveWeights = { ...BASE_WEIGHTS, ...(options.modelWeights || {}), ...contextualWeights };
    const adaptiveWeight = Math.max(1, Number(options.adaptiveWeight) || 1);
    const rankings = ROBOT_STRATEGIES.map((robot) => ({
      weight: robot.weights ? 1 : adaptiveWeight,
      ranked: scoreRaceWithWeights(race, robot.weights ? { ...BASE_WEIGHTS, ...robot.weights } : adaptiveWeights, options.profileScore)
    }));
    const totalRankWeight = rankings.reduce((sum, robot) => sum + robot.weight, 0);
    const stats = new Map();
    for (const { ranked, weight } of rankings) {
      ranked.forEach((horse, index) => {
        const horseKey = Number.isSafeInteger(horse.number) && horse.number > 0
          ? `number:${horse.number}`
          : `name:${normalizeName(horse.name)}`;
        const item = stats.get(horseKey) || { horse, rankTotal: 0, scoreTotal: 0, shareTotal: 0, firstChoiceCount: 0 };
        item.rankTotal += (index + 1) * weight;
        item.scoreTotal += horse.score * weight;
        item.shareTotal += horse.modelShare * weight;
        if (index === 0) item.firstChoiceCount += 1;

        stats.set(horseKey, item);
      });
    }
    const fieldSize = Math.max(1, stats.size);
    return [...stats.values()].map(({ horse, rankTotal, scoreTotal, shareTotal, firstChoiceCount }) => {
      const averageRank = rankTotal / totalRankWeight;
      const consensusScore = (fieldSize === 1 ? 100 : (fieldSize - averageRank) / (fieldSize - 1) * 100) * 0.8 + scoreTotal / totalRankWeight * 0.2;
      return { ...horse, score: Math.round(consensusScore * 10) / 10, averageRank: Math.round(averageRank * 100) / 100, modelShare: shareTotal / totalRankWeight, robotFirstChoiceCount: firstChoiceCount };
    }).sort((a, b) => b.score - a.score || b.modelShare - a.modelShare || Number(a.number) - Number(b.number));
  }

  return { DEFAULT_DNA, BASE_WEIGHTS, normalizeName, distanceBand, raceContextKeys, softmaxScores, analyzeEnsemble };
});
