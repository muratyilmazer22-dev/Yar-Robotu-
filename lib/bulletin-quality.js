(function (root, factory) {
  const quality = factory();
  if (typeof module === 'object' && module.exports) module.exports = quality;
  else root.BulletinQuality = quality;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  function auditCouponPool(races) {
    const items = Array.isArray(races) ? races : [];
    if (items.length !== 6) return { ok: false, error: `Altılı kupon için 6 okunabilir koşu gerekir; ${items.length} koşu bulundu.` };

    const raceNumbers = items.map((race) => Number(race.no));
    if (raceNumbers.some((number) => !Number.isSafeInteger(number) || number < 1) || new Set(raceNumbers).size !== 6) {
      return { ok: false, error: 'Koşu numaraları eksik veya tekrarlı. Yanlış ayak üretmemek için kupon oluşturulmadı; bülteni yeniden yapıştırın.' };
    }

    const finishedNos = items.filter((race) => race.finished).map((race) => Number(race.no));
    if (finishedNos.length) {
      return {
        ok: false,
        code: 'finished-race',
        finishedNos,
        error: `Altılı kupon için altı açık ayak gerekir; ${finishedNos.map((number) => `${number}. koşu`).join(', ')} tamamlandı.`
      };
    }

    for (const race of items) {
      const active = (Array.isArray(race.horses) ? race.horses : []).filter((horse) => !horse.scratched);
      const numbers = active.map((horse) => Number(horse.horseNumber ?? horse.no));
      if (numbers.some((number) => !Number.isSafeInteger(number) || number < 1)) {
        return { ok: false, error: `${race.no}. koşuda numarası okunamayan at var. Yanlış at seçmemek için kupon oluşturulmadı; at numarası ve adı sütunlarıyla bülteni yeniden yapıştırın.` };
      }
      if (new Set(numbers).size !== numbers.length) {
        return { ok: false, error: `${race.no}. koşuda yinelenen at numarası var. Kupon oluşturulmadı; bülten sütunlarını kontrol edip yeniden yapıştırın.` };
      }
      if (!active.length) return { ok: false, error: `${race.no}. koşuda koşabilir at bulunamadı.` };
    }

    return { ok: true };
  }

  function auditRaces(races) {
    const items = Array.isArray(races) ? races : [];
    const warnings = [];
    const seen = new Set();
    for (const race of items) {
      const number = Number(race.no);
      if (!Number.isSafeInteger(number) || number < 1 || seen.has(number)) {
        warnings.push('Bültende eksik veya tekrarlanan koşu numarası var; kupon üretimi durdurulabilir.');
        break;
      }
      seen.add(number);
    }

    const missingDistance = items.filter((race) => !Number.isFinite(Number(race.distance)) || Number(race.distance) <= 0);
    if (missingDistance.length) {
      warnings.push(`Mesafe bilgisi okunamadı: ${missingDistance.map((race) => `${race.no}. koşu`).join(', ')}. Mesafe tahmin edilmedi; mesafeye/pedigriye dayalı sinyaller bu ayaklarda kullanılmıyor.`);
    }

    for (const race of items) {
      const active = (race.horses || []).filter((horse) => !horse.scratched);
      const numbers = active.map((horse) => Number(horse.horseNumber ?? horse.no)).filter((number) => Number.isSafeInteger(number) && number > 0);
      if (new Set(numbers).size !== numbers.length) {
        warnings.push(`${race.no}. koşuda tekrarlanan at numarası saptandı; bu ayak kupon denetiminden geçmeyecek.`);
      }

      const agfLeader = active.filter((horse) => Number.isFinite(Number(horse.agf)) && Number(horse.agf) > 0).sort((a, b) => Number(b.agf) - Number(a.agf))[0];
      const oddsFavorite = active.filter((horse) => Number.isFinite(Number(horse.odds)) && Number(horse.odds) > 0).sort((a, b) => Number(a.odds) - Number(b.odds))[0];
      if (agfLeader && oddsFavorite && (agfLeader.horseNumber ?? agfLeader.no) !== (oddsFavorite.horseNumber ?? oddsFavorite.no) && Number(agfLeader.agf) - Number(oddsFavorite.agf || 0) >= 15) {
        warnings.push(`${race.no}. koşuda AGF lideri #${agfLeader.horseNumber ?? agfLeader.no} ile ganyan favorisi #${oddsFavorite.horseNumber ?? oddsFavorite.no} farklı. İki piyasa sinyali ayrı tutuldu; veriyi kontrol edin.`);
      }
    }

    return [...new Set(warnings)];
  }

  return { auditCouponPool, auditRaces };
});
