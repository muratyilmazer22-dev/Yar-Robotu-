(function (root, factory) {
  const resultEvidence = factory();
  if (typeof module === "object" && module.exports) module.exports = resultEvidence;
  else root.ResultEvidence = resultEvidence;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  function normalizeHeader(value) {
    return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").trim().replace(/\s+/g, " ");
  }

  function hasFinishOrder(text) {
    return String(text || "").split(/\r?\n/).some((line) => {
      const cells = line.split(/[\t|]/).map(normalizeHeader);
      const hasHorseColumn = cells.some((cell) => /^(?:n\s+)?at(?: no| adi| ismi)?$/.test(cell) || /^(?:horse(?: name| no| number)?|runner)$/.test(cell));
      const hasFinishColumn = cells.some((cell) => /^(?:sira(?: no)?|sonuc|result|rank|placing|position)$/.test(cell));
      return hasHorseColumn && hasFinishColumn;
    });
  }

  return { hasFinishOrder };
});
