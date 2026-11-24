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
    for (const leg of completed) {
      const winner = results.get(Number(leg.raceNo));
      if ((leg.horses || []).some((horse) => Number(horse.number) === winner)) hits += 1;
      else missedRaceNos.push(Number(leg.raceNo));
    }
    return { completed: completed.length, total: Array.isArray(legs) ? legs.length : 0, hits, missedRaceNos };
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
      return [{ hits: evaluation.hits, costCents: Math.round(cost * 100) }];
    });
    const budgetGroups = new Map();
    let totalHits = 0;
    let sixOfSix = 0;
    let fiveOfSix = 0;
    for (const coupon of completed) {
      totalHits += coupon.hits;
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
      byBudget: Array.from(budgetGroups.values()).sort((a, b) => a.costCents - b.costCents).map((group) => ({
        ...group,
        budget: Number((group.costCents / 100).toFixed(2)),
        sixOfSixRate: percentage(group.sixOfSix, group.coupons),
        fiveOfSixRate: percentage(group.fiveOfSix, group.coupons),
        averageHits: Number((group.totalHits / group.coupons).toFixed(2))
      }))
    };
  }

  return { evaluateCouponLegs, evaluateSixLegCoupons };
});
