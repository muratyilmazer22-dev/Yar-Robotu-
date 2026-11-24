(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RaceLearningEvaluation = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  function identity(outcome) {
    const sourceKey = String(outcome.sourceKey || "");
    if (sourceKey.startsWith("tjk:")) return sourceKey.slice(4);
    return sourceKey || `${String(outcome.at || "").slice(0, 10)}:${outcome.city || ""}:${outcome.raceNo}`;
  }

  function isPersonalBulletinOutcome(outcome) {
    return !String(outcome?.sourceKey || "").startsWith("tjk:");
  }

  function normalizedCity(value) {
    return String(value || "").toLocaleUpperCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "I").replace(/[^A-Z0-9]/g, "");
  }

  function predictionIdentity(prediction) {
    const raceKey = `${prediction.date || ""}:${normalizedCity(prediction.city)}:${prediction.no ?? ""}`;
    return prediction.runId ? `${raceKey}:${prediction.runId}` : raceKey;
  }

  function mergePredictions(existing, incoming) {
    const merged = new Map();
    for (const prediction of existing || []) merged.set(predictionIdentity(prediction), prediction);
    for (const prediction of incoming || []) merged.set(predictionIdentity(prediction), prediction);
    return [...merged.values()].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))
      || String(a.city || "").localeCompare(String(b.city || ""), "tr")
      || Number(a.no || 0) - Number(b.no || 0)
      || String(a.predictionCreatedAt || "").localeCompare(String(b.predictionCreatedAt || "")));
  }

  function latestOutcomePerRace(outcomes) {
    const latest = new Map();
    for (const item of outcomes || []) {
      const key = `${String(item.at || "").slice(0, 10)}:${normalizedCity(item.city)}:${item.raceNo}`;
      const current = latest.get(key);
      if (!current || String(item.predictionCreatedAt || item.at || "") >= String(current.predictionCreatedAt || current.at || "")) latest.set(key, item);
    }
    return [...latest.values()];
  }

  function rankForWeights(horses, weights) {
    return [...horses].sort((a, b) => {
      const score = (horse) => {
        const features = horse.features || {};
        const values = Object.entries(weights).filter(([key]) => Number.isFinite(features[key]));
        const total = values.reduce((sum, [key, value]) => sum + value, 0);
        return total ? values.reduce((sum, [key, weight]) => sum + features[key] * weight, 0) / total : 50;
      };
      return score(b) - score(a);
    });
  }

  function evaluateForwardComparison(outcomes, baselineWeights, minimumContextSample = 30) {
    const valid = latestOutcomePerRace(outcomes.filter((item) => isPersonalBulletinOutcome(item) && Array.isArray(item.horses) && item.horses.length > 1 && item.horses.some((horse) => Number(horse.number) === Number(item.winner)) && /^\d{4}-\d{2}-\d{2}$/.test(String(item.at || "").slice(0, 10))));
    const dates = [...new Set(valid.map((item) => String(item.at).slice(0, 10)))].sort();
    if (dates.length < 5) return { validated: false, startDate: null, endDate: dates.at(-1) || null, races: 0, minimumContextSample, byModel: {}, byContext: [] };
    const startDate = dates[Math.floor(dates.length * 0.8)];
    const forward = valid.filter((item) => String(item.at).slice(0, 10) >= startDate);
    const groups = new Map();
    const totals = { learned: { races: 0, wins: 0 }, favorite: { races: 0, wins: 0 }, fixed: { races: 0, wins: 0 } };
    for (const item of forward) {
      const winner = Number(item.winner);
      const learned = [...item.horses].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      const fixed = rankForWeights(item.horses, baselineWeights);
      const favorite = item.horses.filter((horse) => horse.marketScore !== null && horse.marketScore !== undefined && Number.isFinite(Number(horse.marketScore))).sort((a, b) => Number(b.marketScore) - Number(a.marketScore))[0];
      for (const [name, leader] of [["learned", learned[0]], ["fixed", fixed[0]]]) {
        totals[name].races += 1;
        if (Number(leader?.number) === winner) totals[name].wins += 1;
      }
      if (favorite) {
        totals.favorite.races += 1;
        if (Number(favorite.number) === winner) totals.favorite.wins += 1;
      }
      for (const [kind, value] of [["surface", item.surface], ["type", item.type]]) {
        if (!value) continue;
        const key = `${kind}|${value}`;
        const group = groups.get(key) || { kind, name: value, races: 0, learnedWins: 0, favoriteWins: 0, fixedWins: 0 };
        group.races += 1;
        group.learnedWins += Number(Number(learned[0]?.number) === winner);
        group.fixedWins += Number(Number(fixed[0]?.number) === winner);
        group.favoriteWins += Number(Boolean(favorite && Number(favorite.number) === winner));
        groups.set(key, group);
      }
    }
    const byModel = Object.fromEntries(Object.entries(totals).map(([name, values]) => [name, { ...values, hitRate: values.races ? values.wins / values.races : null }]));
    const byContext = [...groups.values()].map((group) => ({
      ...group,
      eligible: group.races >= minimumContextSample,
      learnedHitRate: group.races ? group.learnedWins / group.races : null,
      favoriteHitRate: group.races ? group.favoriteWins / group.races : null,
      fixedHitRate: group.races ? group.fixedWins / group.races : null
    }));
    return { validated: true, startDate, endDate: dates.at(-1), races: forward.length, minimumContextSample, byModel, byContext };
  }

  function mergeOutcomes(outcomes, incomingItems) {
    const next = [...outcomes];
    const indexes = new Map();
    next.forEach((item, index) => {
      const key = identity(item);
      if (!indexes.has(key)) indexes.set(key, index);
    });
    let added = 0;
    let corrected = 0;

    for (const incoming of incomingItems) {
      const key = identity(incoming);
      const index = indexes.get(key);
      if (index === undefined) {
        indexes.set(key, next.length);
        next.push(incoming);
        added += 1;
      } else {
        const existingIsPersonal = isPersonalBulletinOutcome(next[index]);
        const incomingIsPersonal = isPersonalBulletinOutcome(incoming);
        if (incomingIsPersonal && !existingIsPersonal) {
          next[index] = incoming;
          added += 1;
        } else if (existingIsPersonal && !incomingIsPersonal) {
          continue;
        } else if (Number(next[index].winner) !== Number(incoming.winner)) {
          next[index] = incoming;
          corrected += 1;
        }
      }
    }

    return { outcomes: next, added, corrected };
  }

  function mergeOutcome(outcomes, incoming) {
    const merged = mergeOutcomes(outcomes, [incoming]);
    return { ...merged, added: Boolean(merged.added), corrected: Boolean(merged.corrected) };
  }

  return { identity, isPersonalBulletinOutcome, predictionIdentity, mergePredictions, latestOutcomePerRace, evaluateForwardComparison, mergeOutcome, mergeOutcomes };
});
