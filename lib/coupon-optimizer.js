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

  const SURPRISE_COVERAGE_UTILITY_BONUS = 0.08;

  function getSurpriseEvidence(unit) {
    const members = Array.isArray(unit?.members) && unit.members.length ? unit.members : [unit];
    return members
      .filter((horse) => horse?.signal === 'Sürpriz adayı')
      .map((horse) => {
        const independentCoverage = clamp(Number(horse.independentCoverage) || 0, 0, 100);
        const coverage = clamp(Number(horse.coverage) || 0, 0, 100);
        const performanceScore = Number(horse.performanceScore);
        const marketScore = Number(horse.marketScore);
        const edge = performanceScore - marketScore;
        if (independentCoverage < 35 || coverage < 40 || !Number.isFinite(edge) || edge < 12) return null;
        return { horse, edge, strength: edge * Math.sqrt(independentCoverage * coverage) / 100 };
      })
      .filter(Boolean)
      .sort((a, b) => b.strength - a.strength)[0] || null;
  }

  function prioritizeCoverageCandidate(ranked) {
    const ordered = ranked.map((unit, index) => ({
      ...unit,
      modelRank: index + 1,
      members: (Array.isArray(unit.members) && unit.members.length ? unit.members : [unit]).map((horse) => ({
        ...horse,
        modelRank: index + 1
      }))
    }));
    const alternatives = ordered
      .map((unit, index) => ({ unit, index, evidence: getSurpriseEvidence(unit) }))
      .filter(({ index, evidence }) => index > 0 && evidence)
      .sort((a, b) => b.evidence.strength - a.evidence.strength || a.index - b.index);
    const alternative = alternatives[0];
    if (!alternative) return { ranked: ordered, candidate: null, candidateIndex: -1 };

    const [candidateUnit] = ordered.splice(alternative.index, 1);
    candidateUnit.coverageCandidate = true;
    candidateUnit.coverageEdge = alternative.evidence.edge;
    candidateUnit.members = candidateUnit.members.map((horse) => {
      const isSignalHorse = (horse.number !== null && horse.number !== undefined && Number(horse.number) === Number(alternative.evidence.horse.number))
        || (horse.name && horse.name === alternative.evidence.horse.name);
      return {
        ...horse,
        coverageCandidate: Boolean(isSignalHorse),
        coverageEdge: isSignalHorse ? alternative.evidence.edge : null
      };
    });
    ordered.splice(1, 0, candidateUnit);

    return {
      ranked: ordered,
      candidate: {
        number: alternative.evidence.horse.number,
        name: alternative.evidence.horse.name,
        modelRank: alternative.index + 1,
        edge: alternative.evidence.edge
      },
      candidateIndex: 1
    };
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
          const includesCoverageCandidate = Number.isInteger(pick.coverageCandidateIndex) && pick.coverageCandidateIndex >= 0 && pick.coverageCandidateIndex < count;
          const candidateBonus = includesCoverageCandidate ? Math.max(0, Number(pick.coverageBonus) || 0) : 0;
          const score = state.score + allocationPriority * Math.log(Math.max(Number.EPSILON, coverage)) + candidateBonus;
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

  return { getAllocationPriority, prioritizeCoverageCandidate, SURPRISE_COVERAGE_UTILITY_BONUS, optimizeCouponCounts };
});
