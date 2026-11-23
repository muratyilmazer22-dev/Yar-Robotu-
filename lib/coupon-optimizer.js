(function (root, factory) {
  const optimizer = factory();
  if (typeof module === 'object' && module.exports) module.exports = optimizer;
  else root.CouponOptimizer = optimizer;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function getAllocationPriority(pick) {
    const leader = pick.ranked?.[0];
    if (!leader) return 1;
    const coverageConfidence = clamp(Number(leader.independentCoverage) || 0, 0, 100) / 100;
    return 1 + (1 - coverageConfidence);
  }

  function optimizeCouponCounts(picks, maxColumns, allowUnvalidatedSingles, maxSingles = 1) {
    let states = new Map([['1:0', { columns: 1, singles: 0, score: 0, counts: [] }]]);
    for (const pick of picks) {
      const nextStates = new Map();
      const cumulativeShares = [];
      pick.ranked.forEach((horse, index) => {
        cumulativeShares[index] = (cumulativeShares[index - 1] || 0) + horse.modelShare;
      });
      const firstCount = pick.singleEligible || allowUnvalidatedSingles || pick.ranked.length === 1 ? 1 : 2;
      const allocationPriority = getAllocationPriority(pick);
      for (const state of states.values()) {
        for (let count = firstCount; count <= pick.ranked.length; count++) {
          const isDecisionSingle = count === 1 && pick.ranked.length > 1;
          const singles = state.singles + Number(isDecisionSingle);
          if (singles > maxSingles || state.columns > maxColumns / count) continue;
          const columns = state.columns * count;
          const coverage = Math.min(1, cumulativeShares[count - 1]);
          const score = state.score + allocationPriority * Math.log(Math.max(Number.EPSILON, coverage));
          const key = `${columns}:${singles}`;
          const previous = nextStates.get(key);
          if (!previous || score > previous.score) {
            nextStates.set(key, { columns, singles, score, counts: [...state.counts, count] });
          }
        }
      }
      states = nextStates;
      if (!states.size) return null;
    }
    let best = null;
    for (const state of states.values()) {
      if (!best || state.score > best.score) best = { ...state, columns: state.columns };
    }
    return best;
  }

  return { getAllocationPriority, optimizeCouponCounts };
});
