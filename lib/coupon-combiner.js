(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CouponCombiner = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function combineRankings(mainSelection, criterionSelection) {
    const sources = [mainSelection, criterionSelection].filter((ranking) => Array.isArray(ranking) && ranking.length > 0);
    if (!sources.length) return [];

    const candidates = new Map();
    for (const ranking of sources) {
      ranking.forEach((horse, index) => {
        const candidate = candidates.get(horse.number) || { horse, scoreTotal: 0 };
        candidate.scoreTotal += (ranking.length - index) / ranking.length;
        candidates.set(horse.number, candidate);
      });
    }

    const ranked = [...candidates.values()].map(({ horse, scoreTotal }) => ({
      ...horse,
      score: Math.round((scoreTotal / sources.length) * 1000) / 10
    })).sort((a, b) => b.score - a.score || Number(a.number) - Number(b.number));

    const maximum = ranked[0]?.score || 0;
    const shares = ranked.map((horse) => Math.exp((horse.score - maximum) / 12.5));
    const total = shares.reduce((sum, share) => sum + share, 0) || 1;
    return ranked.map((horse, index) => ({ ...horse, modelShare: shares[index] / total }));
  }

  return { combineRankings };
});
