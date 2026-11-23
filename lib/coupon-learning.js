(function (root, factory) {
  const learning = factory();
  if (typeof module === "object" && module.exports) module.exports = learning;
  else root.CouponLearning = learning;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  function raceIdentity(record) {
    const city = String(record?.city || "").toLocaleUpperCase("tr-TR").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "I").replace(/[^A-Z0-9]/g, "");
    return `${String(record?.date || record?.at || "").slice(0, 10)}:${city}:${Number(record?.raceNo)}`;
  }

  function analyzePredictionResult(prediction, winnerNumber, selectedNumbers = []) {
    const horses = Array.isArray(prediction?.horses) ? prediction.horses : [];
    const winner = Number(winnerNumber);
    const winnerRank = horses.findIndex((horse) => Number(horse.number) === winner) + 1;
    if (!prediction || winnerRank < 1) return { matched: false, winnerRank: null, selectedHit: false, top3Hit: false, category: "tahmin-eşleşmedi" };
    const selected = new Set(selectedNumbers.map(Number));
    const selectedHit = selected.has(winner);
    return {
      matched: true,
      winnerRank,
      selectedHit,
      top3Hit: winnerRank <= 3,
      category: selectedHit ? "kupon-isabeti" : winnerRank <= 3 ? "model-top3-kupon-dışı" : "model-sıralaması-geride",
      surface: prediction.surface || "Belirtilmemiş",
      type: prediction.type || "Belirtilmemiş",
      distance: Number(prediction.distance) || null
    };
  }

  function outcomeFromPrediction(prediction, winnerNumber) {
    const horses = Array.isArray(prediction?.horses) ? prediction.horses : [];
    const winner = Number(winnerNumber);
    const winnerHorse = horses.find((horse) => Number(horse.number) === winner);
    if (!winnerHorse || horses.length < 2 || !horses.every((horse) => Number.isSafeInteger(Number(horse.number)))) return null;
    const marketFavorite = horses.filter((horse) => Number.isFinite(Number(horse.marketScore))).sort((a, b) => Number(b.marketScore) - Number(a.marketScore))[0];
    const winnerRank = horses.findIndex((horse) => Number(horse.number) === winner) + 1;
    return {
      city: String(prediction.city || ""),
      raceNo: Number(prediction.no ?? prediction.raceNo),
      winner,
      winnerName: String(winnerHorse.name || ""),
      modelVersion: String(prediction.modelVersion || "legacy-ensemble-v0"),
      top3Hit: winnerRank <= 3,
      top1Hit: winnerRank === 1,
      favoriteMiss: marketFavorite ? Number(marketFavorite.number) !== winner : null,
      surpriseHit: winnerHorse.signal === "Sürpriz adayı",
      singleGap: horses.length > 1 ? Number(horses[0].score || 0) - Number(horses[1].score || 0) : 0,
      singleCandidate: false,
      singleHit: false,
      horses: horses.map((horse) => ({
        number: Number(horse.number),
        name: String(horse.name || ""),
        score: Number(horse.score) || 0,
        features: horse.features && typeof horse.features === "object" ? { ...horse.features } : {},
        performanceScore: horse.performanceScore ?? null,
        marketScore: horse.marketScore ?? null,
        coverage: horse.coverage ?? null,
        independentCoverage: horse.independentCoverage ?? null,
        signal: String(horse.signal || "")
      })),
      surface: String(prediction.surface || "Belirtilmemiş"),
      type: String(prediction.type || "DİĞER"),
      distance: Number(prediction.distance) || null,
      at: `${String(prediction.date || "").slice(0, 10)}T12:00:00.000Z`,
      learningSource: "coupon-leg-result"
    };
  }

  return { raceIdentity, analyzePredictionResult, outcomeFromPrediction };
});
