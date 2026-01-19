let detectedDemographics = null; // { table, pidCol, sexCol, ageCol, countryCol }

function qIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function detectDemographics(client) {
  if (detectedDemographics !== null) return detectedDemographics;
  const tableCandidates = ['prolific_participants', 'prolific_demographic', 'prolofic_demographic'];
  const pickFirstPresent = async (table) => {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [table]
    );
    if (!rows || rows.length === 0) return null;
    const colsExact = rows.map(r => String(r.column_name));
    const colsNorm = colsExact.map(c => c.toLowerCase().replace(/[\s_]+/g, ''));
    const pick = (cands) => {
      for (const cand of cands) {
        const norm = cand.toLowerCase().replace(/[\s_]+/g, '');
        const idx = colsNorm.indexOf(norm);
        if (idx !== -1) return colsExact[idx];
      }
      return null;
    };
    const pidCol = pick(['prolific_pid', 'prolific id', 'prolific_id', 'participant id', 'participant_id', 'prolificid']);
    if (!pidCol) return null;
    return {
      table,
      pidCol,
      sexCol: pick(['sex', 'gender']) || null,
      ageCol: pick(['age', 'age years', 'age_years']) || null,
      countryCol: pick(['country of residence', 'country_of_residence', 'country', 'residence country', 'residence_country']) || null
    };
  };
  for (const t of tableCandidates) {
    try {
      const found = await pickFirstPresent(t);
      if (found) {
        detectedDemographics = found;
        console.log('🧭 Detected demographics source:', found);
        return detectedDemographics;
      }
    } catch (_) {}
  }
  detectedDemographics = null;
  console.log('🧭 No demographics source detected');
  return null;
}

module.exports = {
  detectDemographics,
  qIdent
};
