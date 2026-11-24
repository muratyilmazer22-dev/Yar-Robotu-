function createReturnMetrics() {
  return { races: 0, wins: 0, pricedRaces: 0, grossReturn: 0 };
}

function recordReturn(metrics, selection, winner, winningOdds) {
  if (!selection) return;
  const won = Number(selection.number) === Number(winner);
  metrics.races += 1;
  metrics.wins += Number(won);
  if (Number.isFinite(winningOdds) && winningOdds > 0) {
    metrics.pricedRaces += 1;
    metrics.grossReturn += won ? winningOdds : 0;
  }
}

function finalizeReturnMetrics(metrics) {
  const netReturn = metrics.pricedRaces ? metrics.grossReturn - metrics.pricedRaces : null;
  return {
    ...metrics,
    hitRate: metrics.races ? Number((metrics.wins / metrics.races * 100).toFixed(1)) : null,
    netReturn: netReturn === null ? null : Number(netReturn.toFixed(2)),
    roi: netReturn === null ? null : Number((netReturn / metrics.pricedRaces * 100).toFixed(1))
  };
}

module.exports = { createReturnMetrics, recordReturn, finalizeReturnMetrics };
