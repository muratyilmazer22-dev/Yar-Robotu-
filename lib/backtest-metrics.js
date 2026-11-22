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

module.exports = { getWinnerRank, getWinnerRankBucket };
