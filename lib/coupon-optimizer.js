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

  function getStrongMarketFavorite(unit) {
    const members = Array.isArray(unit?.members) && unit.members.length ? unit.members : [unit];
    const horse = members.find((candidate) => Number(candidate?.marketRank) === 1
      && Number(candidate?.agf) >= 25
      && Number(candidate?.odds) > 0
      && Number(candidate?.odds) <= 3
      && Number(candidate?.modelRank) <= 2
      && Number(candidate?.independentCoverage) >= 50
      && Number(candidate?.coverage) >= 50
      && Number(candidate?.performanceScore) >= 65
      && Number(candidate?.marketAgreement) >= 60
      && Number(candidate?.marketScore) - Number(candidate?.performanceScore) <= 15);
    return horse ? { horse, strength: Number(horse.agf) / Number(horse.odds) } : null;
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
    const marketFavoriteEntry = ordered
      .map((unit, index) => ({ unit, index, evidence: getStrongMarketFavorite(unit) }))
      .find(({ evidence }) => evidence) || null;
    let marketFavorite = null;
    let marketFavoritePromoted = false;
    if (marketFavoriteEntry) {
      const [favoriteUnit] = ordered.splice(marketFavoriteEntry.index, 1);
      favoriteUnit.marketFavorite = true;
      favoriteUnit.members = favoriteUnit.members.map((horse) => ({
        ...horse,
        marketFavorite: horse === marketFavoriteEntry.evidence.horse
      }));
      marketFavoritePromoted = marketFavoriteEntry.index > 0;
      if (marketFavoritePromoted) ordered.unshift(favoriteUnit);
      else ordered.splice(marketFavoriteEntry.index, 0, favoriteUnit);
      marketFavorite = {
        number: marketFavoriteEntry.evidence.horse.number,
        name: marketFavoriteEntry.evidence.horse.name,
        modelRank: marketFavoriteEntry.index + 1,
        marketRank: 1,
        agf: Number(marketFavoriteEntry.evidence.horse.agf),
        odds: Number(marketFavoriteEntry.evidence.horse.odds)
      };
    }
    const alternatives = ordered
      .map((unit, index) => ({ unit, index, evidence: getSurpriseEvidence(unit) }))
      .filter(({ index, evidence }) => index > (marketFavoritePromoted ? 1 : 0) && evidence)
      .sort((a, b) => b.evidence.strength - a.evidence.strength || a.index - b.index);
    const alternative = alternatives[0];
    if (!alternative) return { ranked: ordered, candidate: null, candidateIndex: -1, marketFavorite, marketFavoriteIndex: marketFavorite ? 0 : -1 };

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
    const candidateIndex = marketFavoritePromoted ? 2 : 1;
    ordered.splice(candidateIndex, 0, candidateUnit);

    return {
      ranked: ordered,
      candidate: {
        number: alternative.evidence.horse.number,
        name: alternative.evidence.horse.name,
        modelRank: alternative.index + 1,
        edge: alternative.evidence.edge
      },
      candidateIndex,
      marketFavorite,
      marketFavoriteIndex: marketFavorite ? 0 : -1
    };
  }

  function getPoolStarts(races, bulletinText = "") {
    const raceNumbers = [...new Set((Array.isArray(races) ? races : [])
      .map((race) => Number(race?.no))
      .filter((number) => Number.isSafeInteger(number) && number > 0))].sort((a, b) => a - b);
    if (!raceNumbers.length) return [];

    const normalizedBulletin = String(bulletinText || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i");
    const raceSections = normalizedBulletin.split(/(?=^[ \t]*\d+\.\s*(?:kosu|race)\b)/im).filter(Boolean);
    const hasOfficialMarker = (section) => /\b6\s*['’`´]?\s*li\s+ganyan\b[\s\S]{0,160}?\bbu\s+kosudan\s+baslar\b/i.test(section);
    const officialMarkerSections = raceSections.filter(hasOfficialMarker);
    const markedStarts = [...new Set(officialMarkerSections
      .map((section) => Number(section.match(/^[ \t]*(\d+)\./)?.[1]))
      .filter((number) => raceNumbers.includes(number)))].sort((a, b) => a - b);
    if (officialMarkerSections.length) {
      return markedStarts;
    }

    const firstRace = raceNumbers[0];
    const lastRace = raceNumbers[raceNumbers.length - 1];
    const starts = [firstRace];
    const secondPoolStart = firstRace + 1;
    if (lastRace >= secondPoolStart + 5) starts.push(secondPoolStart);
    return starts;
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

  return { getAllocationPriority, prioritizeCoverageCandidate, SURPRISE_COVERAGE_UTILITY_BONUS, getPoolStarts, optimizeCouponCounts };
});
