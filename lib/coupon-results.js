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

  return { evaluateCouponLegs };
});
