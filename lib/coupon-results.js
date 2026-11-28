(function (root, factory) {
  const evaluator = factory();
  if (typeof module === 'object' && module.exports) module.exports = evaluator;
  else root.CouponResults = evaluator;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  function evaluateCouponLegs(legs, legResults) {
    const results = new Map((Array.isArray(legResults) ? legResults : [])
      .filter((result) => Number.isSafeInteger(Number(result.winnerNumber)) && Number(result.winnerNumber) > 0)
      .map((result) => [Number(result.raceNo), Number(result.winnerNumber)]));
    const completed = (Array.isArray(legs) ? legs : []).filter((leg) => results.has(Number(leg.raceNo)));
    const missedRaceNos = [];
    let hits = 0;
    let coverageCandidateEvaluated = 0;
    let coverageCandidateHits = 0;
    let coverageCandidateOutsideHits = 0;
    for (const leg of completed) {
      const winner = results.get(Number(leg.raceNo));
      const selectedHit = (leg.horses || []).some((horse) => Number(horse.number) === winner);
      if (selectedHit) hits += 1;
      else missedRaceNos.push(Number(leg.raceNo));
      const candidateNumber = Number(leg.coverageCandidate?.number);
      if (!Number.isSafeInteger(candidateNumber) || candidateNumber < 1) continue;
      coverageCandidateEvaluated += 1;
      if (candidateNumber === winner) {
        coverageCandidateHits += 1;
        if (!selectedHit) coverageCandidateOutsideHits += 1;
      }
    }
    return {
      completed: completed.length,
      total: Array.isArray(legs) ? legs.length : 0,
      hits,
      missedRaceNos,
      coverageCandidateEvaluated,
      coverageCandidateHits,
      coverageCandidateOutsideHits
    };
  }

  function auditFixedPicks(rankedUnits, winnerNumber) {
    const units = Array.isArray(rankedUnits) ? rankedUnits : [];
    const winner = Number(winnerNumber);
    const membersOf = (unit) => Array.isArray(unit?.members) && unit.members.length ? unit.members : [unit];
    const winnerUnitIndex = units.findIndex((unit) => membersOf(unit).some((horse) => Number(horse?.number) === winner));
    const winnerHorse = winnerUnitIndex >= 0 ? membersOf(units[winnerUnitIndex]).find((horse) => Number(horse?.number) === winner) : null;
    const comparisonHorses = units.slice(0, 4).flatMap((unit, index) => membersOf(unit)
      .filter((horse) => Number(horse?.number) !== winner)
      .map((horse) => ({ horse, rank: index + 1 })));
    return {
      winnerRank: winnerUnitIndex >= 0 ? winnerUnitIndex + 1 : null,
      winnerHorse: winnerHorse || null,
      top3Hit: units.slice(0, 3).some((unit) => membersOf(unit).some((horse) => Number(horse?.number) === winner)),
      top4Hit: units.slice(0, 4).some((unit) => membersOf(unit).some((horse) => Number(horse?.number) === winner)),
      comparisonHorses
    };
  }

  function synchronizeCouponResults(coupon, races) {
    if (!coupon || !Array.isArray(coupon.legs)) return false;
    const winners = new Map((Array.isArray(races) ? races : []).flatMap((race) => {
      const firstPlace = (race.horses || []).filter((horse) => Number(horse.place) === 1);
      return firstPlace.length === 1 && Number.isSafeInteger(Number(firstPlace[0].number)) && Number(firstPlace[0].number) > 0
        ? [[Number(race.no), Number(firstPlace[0].number)]]
        : [];
    }));
    const results = new Map((coupon.legResults || []).map((result) => [Number(result.raceNo), Number(result.winnerNumber)]));
    for (const [raceNo, winnerNumber] of winners) results.set(raceNo, winnerNumber);
    const nextResults = coupon.legs.flatMap((leg) => {
      const winnerNumber = results.get(Number(leg.raceNo));
      return Number.isSafeInteger(winnerNumber) && winnerNumber > 0
        ? [{ raceNo: Number(leg.raceNo), winnerNumber }]
        : [];
    });
    const changed = JSON.stringify(coupon.legResults || []) !== JSON.stringify(nextResults);
    coupon.legResults = nextResults;
    return changed;
  }

  function evaluateSixLegCoupons(records) {
    const poolTypes = new Set(['first', 'second', 'third', 'fourth', 'fifth', 'sixth']);
    const eligible = (Array.isArray(records) ? records : []).filter((record) => {
      if (record?.source !== 'Yarış Robotu' || !poolTypes.has(record.poolType) || !Array.isArray(record.legs) || record.legs.length !== 6) return false;
      return new Set(record.legs.map((leg) => Number(leg.raceNo))).size === 6;
    });
    const completed = eligible.flatMap((record) => {
      const evaluation = evaluateCouponLegs(record.legs, record.legResults);
      const cost = Number(record.cost);
      if (evaluation.completed !== 6 || evaluation.total !== 6 || !Number.isFinite(cost) || cost <= 0) return [];
      return [{
        hits: evaluation.hits,
        costCents: Math.round(cost * 100),
        coverageCandidateEvaluated: evaluation.coverageCandidateEvaluated,
        coverageCandidateHits: evaluation.coverageCandidateHits,
        coverageCandidateOutsideHits: evaluation.coverageCandidateOutsideHits
      }];
    });
    const budgetGroups = new Map();
    let totalHits = 0;
    let sixOfSix = 0;
    let fiveOfSix = 0;
    let coverageCandidateEvaluated = 0;
    let coverageCandidateHits = 0;
    let coverageCandidateOutsideHits = 0;
    for (const coupon of completed) {
      totalHits += coupon.hits;
      coverageCandidateEvaluated += coupon.coverageCandidateEvaluated;
      coverageCandidateHits += coupon.coverageCandidateHits;
      coverageCandidateOutsideHits += coupon.coverageCandidateOutsideHits;
      if (coupon.hits === 6) sixOfSix += 1;
      if (coupon.hits === 5) fiveOfSix += 1;
      const group = budgetGroups.get(coupon.costCents) || { costCents: coupon.costCents, coupons: 0, sixOfSix: 0, fiveOfSix: 0, totalHits: 0 };
      group.coupons += 1;
      group.sixOfSix += Number(coupon.hits === 6);
      group.fiveOfSix += Number(coupon.hits === 5);
      group.totalHits += coupon.hits;
      budgetGroups.set(coupon.costCents, group);
    }
    const percentage = (value, total) => total ? Number((value / total * 100).toFixed(1)) : null;
    return {
      eligibleCoupons: eligible.length,
      evaluatedCoupons: completed.length,
      incompleteCoupons: eligible.length - completed.length,
      sixOfSix,
      sixOfSixRate: percentage(sixOfSix, completed.length),
      fiveOfSix,
      fiveOfSixRate: percentage(fiveOfSix, completed.length),
      averageHits: completed.length ? Number((totalHits / completed.length).toFixed(2)) : null,
      coverageCandidateEvaluated,
      coverageCandidateHits,
      coverageCandidateOutsideHits,
      coverageCandidateHitRate: percentage(coverageCandidateHits, coverageCandidateEvaluated),
      byBudget: Array.from(budgetGroups.values()).sort((a, b) => a.costCents - b.costCents).map((group) => ({
        ...group,
        budget: Number((group.costCents / 100).toFixed(2)),
        sixOfSixRate: percentage(group.sixOfSix, group.coupons),
        fiveOfSixRate: percentage(group.fiveOfSix, group.coupons),
        averageHits: Number((group.totalHits / group.coupons).toFixed(2))
      }))
    };
  }

  return { evaluateCouponLegs, evaluateSixLegCoupons, auditFixedPicks, synchronizeCouponResults };
});
