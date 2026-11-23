(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RaceEkuri = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  function normalizeGroup(value) {
    return String(value || '').toLocaleUpperCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'I').replace(/[^A-Z0-9]/g, '');
  }

  function selectionUnits(ranked) {
    const groups = new Map();
    for (const horse of ranked) {
      const groupId = normalizeGroup(horse.couplingGroup);
      const key = groupId ? `ekuri:${groupId}` : `horse:${horse.number ?? horse.name}`;
      const members = groups.get(key) || [];
      members.push(horse);
      groups.set(key, members);
    }

    return [...groups.values()].map((members) => {
      const ordered = [...members].sort((a, b) => Number(b.modelShare || 0) - Number(a.modelShare || 0) || Number(b.score || 0) - Number(a.score || 0));
      const strongest = ordered[0];
      if (members.length === 1) return { ...strongest, members: ordered, isCoupled: false };
      const modelShare = ordered.reduce((total, horse) => total + (Number(horse.modelShare) || 0), 0);
      const weightedScore = modelShare
        ? ordered.reduce((total, horse) => total + (Number(horse.score) || 0) * (Number(horse.modelShare) || 0), 0) / modelShare
        : Math.max(...ordered.map((horse) => Number(horse.score) || 0));
      return {
        ...strongest,
        score: weightedScore,
        modelShare,
        independentCoverage: Math.max(...ordered.map((horse) => Number(horse.independentCoverage) || 0)),
        members: ordered,
        isCoupled: true
      };
    }).sort((a, b) => Number(b.modelShare || 0) - Number(a.modelShare || 0) || Number(b.score || 0) - Number(a.score || 0));
  }

  function sameSelection(predictedHorse, winningHorse) {
    if (Number(predictedHorse?.number) === Number(winningHorse?.number)) return true;
    const predictedGroup = normalizeGroup(predictedHorse?.couplingGroup);
    return Boolean(predictedGroup && predictedGroup === normalizeGroup(winningHorse?.couplingGroup));
  }

  return { normalizeGroup, selectionUnits, sameSelection };
});
