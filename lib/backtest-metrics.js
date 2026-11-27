function getWinnerRank(scores, winnerNumber) {
  const index = scores.findIndex((horse) => Number(horse.number) === Number(winnerNumber));
  return index === -1 ? null : index + 1;
}

function getWinnerRankBucket(rank) {
  if (!Number.isInteger(rank) || rank < 1) return null;
  if (rank === 1) return "1";
  if (rank <= 3) return "2–3";
  if (rank <= 6) return "4–6";
  return "7+";
}

function distanceBand(distance) {
  if (distance == null || distance === '') return 'Mesafe belirtilmedi';
  const value = Number(distance);
  if (!Number.isFinite(value) || value <= 0) return 'Mesafe belirtilmedi';
  if (value <= 1300) return '1300 m ve altı';
  if (value < 1800) return '1301–1799 m';
  return '1800 m ve üzeri';
}

function summarizeWinnerRankContexts(records, minimumSample = 30) {
  const dimensions = {
    byMonth: (record) => /^\d{4}-\d{2}/.test(String(record.date || '')) ? String(record.date).slice(0, 7) : 'Tarih belirtilmedi',
    byCity: (record) => String(record.city || '').trim() || 'Hipodrom belirtilmedi',
    byDistanceBand: (record) => distanceBand(record.distance),
    bySurface: (record) => String(record.surface || '').trim() || 'Pist belirtilmedi'
  };
  const result = { minimumSample };
  for (const [name, getKey] of Object.entries(dimensions)) {
    const groups = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      const rank = Number(record.rank);
      if (!Number.isInteger(rank) || rank < 1) continue;
      const key = getKey(record);
      const group = groups.get(key) || { races: 0, lowRankWinners: 0, topThreeWinners: 0, leaderHits: 0, totalWinnerRank: 0 };
      group.races += 1;
      group.lowRankWinners += Number(rank >= 4);
      group.topThreeWinners += Number(rank <= 3);
      group.leaderHits += Number(rank === 1);
      group.totalWinnerRank += rank;
      groups.set(key, group);
    }
    result[name] = Array.from(groups, ([key, group]) => ({
      context: key,
      ...group,
      lowRankWinnerRate: Number((group.lowRankWinners / group.races * 100).toFixed(1)),
      topThreeWinnerRate: Number((group.topThreeWinners / group.races * 100).toFixed(1)),
      leaderHitRate: Number((group.leaderHits / group.races * 100).toFixed(1)),
      averageWinnerRank: Number((group.totalWinnerRank / group.races).toFixed(2)),
      sufficientSample: group.races >= minimumSample
    })).sort((a, b) => a.context.localeCompare(b.context, 'tr'));
  }
  return result;
}

module.exports = { getWinnerRank, getWinnerRankBucket, distanceBand, summarizeWinnerRankContexts };
