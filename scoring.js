(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.RaceScoring = engine;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const DEFAULT_DNA = {
    DIESIS: { B: 2, I: 4, C: 10, S: 4, P: 0 },
    SINGSPIEL: { B: 0, I: 2, C: 8, S: 8, P: 2 },
    VICTORYGALLOP: { B: 4, I: 6, C: 12, S: 4, P: 0 },
    NATIVEKHAN: { B: 2, I: 4, C: 8, S: 2, P: 0 },
    LUXOR: { B: 6, I: 6, C: 4, S: 0, P: 0 },
    KANEKO: { B: 4, I: 8, C: 6, S: 0, P: 0 },
    MENDIP: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    TOROK: { B: 6, I: 6, C: 4, S: 0, P: 0 },
    LIONHEART: { B: 8, I: 4, C: 4, S: 0, P: 0 },
    SRIPAD: { B: 4, I: 6, C: 6, S: 2, P: 0 },
    KURTINIADIS: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    TURBO: { B: 6, I: 6, C: 4, S: 0, P: 0 },
    KAIZBERT: { B: 8, I: 6, C: 2, S: 0, P: 0 },
    OZGUNHAN: { B: 2, I: 4, C: 8, S: 4, P: 0 },
    FLIGHTLINE: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    GUNRUNNER: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    TAPIT: { B: 2, I: 4, C: 10, S: 4, P: 0 },
    MUNNINGS: { B: 8, I: 4, C: 2, S: 0, P: 0 },
    PRACTICALJOKE: { B: 6, I: 6, C: 4, S: 0, P: 0 },
    INVINCIBLESPIRIT: { B: 8, I: 4, C: 2, S: 0, P: 0 },
    CAIROPRINCE: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    GOODMAGIC: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    SMILINGTIGER: { B: 8, I: 4, C: 2, S: 0, P: 0 },
    MALIBUMOON: { B: 4, I: 6, C: 8, S: 2, P: 0 },
    DISTORTEDHUMOR: { B: 6, I: 6, C: 4, S: 0, P: 0 }
  };

  function normalizeName(value) {
    return String(value || '').toLocaleUpperCase('tr-TR').replace(/[^A-ZÇĞİÖŞÜ0-9 ]/g, '').trim();
  }

  function pedigreeScore(name, distance, dna) {
    const profile = (dna && dna[normalizeName(name)]) || DEFAULT_DNA[normalizeName(name)];
    if (!profile) return 50;
    const total = Object.values(profile).reduce((sum, value) => sum + (Number(value) || 0), 0) || 1;
    const speed = ((Number(profile.B) || 0) + (Number(profile.I) || 0)) / total;
    const endurance = ((Number(profile.S) || 0) + (Number(profile.P) || 0)) / total;
    if (distance < 1300) return Math.round(55 + speed * 45);
    if (distance >= 1800) return Math.round(55 + endurance * 45);
    return Math.round(60 + ((Number(profile.C) || 0) / total) * 35);
  }

  function analyzeRace(race, dna) {
    const horses = Array.isArray(race && race.horses) ? race.horses : [];
    const eligible = horses.filter((horse) => !horse.scratched);
    const maxAgf = Math.max(1, ...eligible.map((horse) => Number(horse.agf) || 0));

    const ranked = eligible.map((horse) => {
      const form = String(horse.form || '');
      const formDigits = (form.match(/\d/g) || []).map(Number).filter((value) => value > 0 && value <= 9);
      const formScore = formDigits.length
        ? Math.max(25, 100 - formDigits.slice(0, 6).reduce((sum, value) => sum + value, 0) / formDigits.length * 9)
        : 50;
      const pedigree = pedigreeScore(horse.sire, race.distance, dna) * 0.65 + pedigreeScore(horse.damSire, race.distance, dna) * 0.35;
      const agf = Number(horse.agf) || 0;
      const agfScore = agf ? Math.min(100, (agf / maxAgf) * 80 + 20) : 45;
      const weight = Number(horse.weight) || 55;
      const weightScore = Math.max(35, 100 - Math.max(0, weight - 54) * 3);
      const contributions = {
        form: Number((formScore * 0.38).toFixed(1)),
        agf: Number((agfScore * 0.3).toFixed(1)),
        pedigree: Number((pedigree * 0.2).toFixed(1)),
        weight: Number((weightScore * 0.12).toFixed(1))
      };
      const score = Math.round(formScore * 0.38 + agfScore * 0.3 + pedigree * 0.2 + weightScore * 0.12);
      const availableSignals = [Boolean(formDigits.length), Boolean(agf), Boolean(horse.sire || horse.damSire), Boolean(horse.weight)].filter(Boolean).length;
      const explanation = `Form ${contributions.form} · AGF ${contributions.agf} · Pedigri ${contributions.pedigree} · Sıklet ${contributions.weight}`;
      return { ...horse, score, formScore, agfScore, pedigree, weightScore, contributions, availableSignals, explanation };
    }).sort((a, b) => b.score - a.score || Number(a.no) - Number(b.no));

    const gap = ranked.length > 1 ? ranked[0].score - ranked[1].score : 0;
    const confidence = gap >= 15 ? 'Puan farkı belirgin' : gap >= 8 ? 'Orta fark' : 'Yakın puanlar';
    return ranked.map((horse, index) => ({ ...horse, confidence: index === 0 ? confidence : '' }));
  }

  return { DEFAULT_DNA, normalizeName, pedigreeScore, analyzeRace };
});
