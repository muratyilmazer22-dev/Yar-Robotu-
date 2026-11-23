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
    const valid = outcomes.filter((item) => !String(item.sourceKey || "").startsWith("tjk:") && Array.isArray(item.horses) && item.horses.length > 1 && item.horses.some((horse) => Number(horse.number) === Number(item.winner)) && /^\d{4}-\d{2}-\d{2}$/.test(String(item.at || "").slice(0, 10)));
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

  function mergeOutcome(outcomes, incoming) {
    const index = outcomes.findIndex((item) => identity(item) === identity(incoming));
    if (index < 0) return { outcomes: [...outcomes, incoming], added: true, corrected: false };
    if (Number(outcomes[index].winner) === Number(incoming.winner)) return { outcomes, added: false, corrected: false };
    const next = [...outcomes];
    next[index] = incoming;
    return { outcomes: next, added: false, corrected: true };
  }

  return { identity, evaluateForwardComparison, mergeOutcome };
});
