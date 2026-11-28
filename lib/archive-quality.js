function assessRaceQuality(record) {
  const program = Array.isArray(record.program?.runners) ? record.program.runners : [];
  const results = Array.isArray(record.results?.runners) ? record.results.runners : [];
  const identities = program.map((horse) => Number(horse.horseNumber ?? horse.no)).filter((number) => Number.isSafeInteger(number) && number > 0);
  const resultIdentities = results.map((horse) => Number(horse.horseNumber ?? horse.no)).filter((number) => Number.isSafeInteger(number) && number > 0);
  const duplicateRunnerNumbers = identities.length - new Set(identities).size;
  const duplicateResultNumbers = resultIdentities.length - new Set(resultIdentities).size;
  const winnerCount = results.filter((horse) => Number(horse.finishPosition) === 1).length;
  const programNumbers = new Set(identities);
  const invalidFinishPositions = results.some((horse) => !Number.isSafeInteger(Number(horse.finishPosition)) || Number(horse.finishPosition) < 1);
  const unmatchedResultNumbers = resultIdentities.some((number) => !programNumbers.has(number));
  const issues = [];

  if (program.length < 2) issues.push('program_missing_or_incomplete');
  if (identities.length !== program.length) issues.push('runner_identity_invalid');
  if (!results.length) issues.push('results_missing');
  if (resultIdentities.length !== results.length) issues.push('result_identity_invalid');
  if (invalidFinishPositions) issues.push('finish_position_invalid');
  if (unmatchedResultNumbers) issues.push('result_runner_not_in_program');
  if (duplicateRunnerNumbers) issues.push('duplicate_runner_numbers');
  if (duplicateResultNumbers) issues.push('duplicate_result_numbers');
  if (results.length && winnerCount !== 1) issues.push('winner_count_invalid');

  return {
    status: issues.length ? 'needs_review' : 'complete',
    programRunnerCount: program.length,
    resultRunnerCount: results.length,
    identifiedRunnerCount: identities.length,
    duplicateRunnerNumbers,
    duplicateResultNumbers,
    winnerCount,
    issues
  };
}

function trustedTjkSource(sourceUrls) {
  const candidates = sourceUrls && typeof sourceUrls === 'object' && !Array.isArray(sourceUrls)
    ? Object.values(sourceUrls)
    : [];
  return candidates.some((value) => {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:'
        && !url.username
        && !url.password
        && (url.hostname === 'tjk.org' || url.hostname.endsWith('.tjk.org'));
    } catch {
      return false;
    }
  });
}

function createQualityAuditRows(date, records, warnings = [], source = 'manual_import') {
  return records.map((record) => ({
    raceDate: date,
    city: String(record.city || 'Bilinmiyor'),
    raceNo: Number(record.raceNo),
    eventType: 'import_quality',
    details: {
      source,
      quality: assessRaceQuality(record),
      warnings: warnings.map((warning) => String(warning).slice(0, 500)),
      auditedAt: new Date().toISOString()
    }
  })).filter((record) => Number.isSafeInteger(record.raceNo) && record.raceNo > 0);
}

module.exports = { assessRaceQuality, createQualityAuditRows, trustedTjkSource };
