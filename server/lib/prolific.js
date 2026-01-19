// Use global fetch if available (Node 18+); otherwise lazy-load node-fetch
const httpFetch = (typeof fetch !== 'undefined')
  ? fetch
  : (url, opts) => import('node-fetch').then(m => m.default(url, opts));

function hasNextPage(apiResponse) {
  // Support v1 pagination { results:[], next: url|null } or array fallback
  if (!apiResponse) return false;
  if (Array.isArray(apiResponse)) return false;
  if (typeof apiResponse.next !== 'undefined') return !!apiResponse.next;
  // Some APIs use count/results with page; if fewer than page size, assume no next
  if (Array.isArray(apiResponse.results)) return false; // we handle via explicit 'next'
  return false;
}

async function upsertProlificParticipants(client, apiResponse, studyId) {
  const items = Array.isArray(apiResponse) ? apiResponse : (Array.isArray(apiResponse?.results) ? apiResponse.results : []);
  if (!items.length) return 0;
  const text = `INSERT INTO prolific_participants (prolific_pid, study_id, sex, country_of_residence, age, student_status, employment_status, raw, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
                ON CONFLICT (prolific_pid)
                DO UPDATE SET study_id=EXCLUDED.study_id, sex=EXCLUDED.sex, country_of_residence=EXCLUDED.country_of_residence, age=EXCLUDED.age, student_status=EXCLUDED.student_status, employment_status=EXCLUDED.employment_status, raw=EXCLUDED.raw, updated_at=now()`;
  let n = 0;
  for (const it of items) {
    // Try common shapes
    const pid = it.prolific_id || it.participant_id || it.id || it.PROLIFIC_PID;
    if (!pid) continue;
    const demographics = it.demographics || it || {};
    const sex = demographics.sex || demographics.gender || null;
    const country = demographics.country_of_residence || demographics.country || null;
    const ageRaw = demographics.age;
    const age = (ageRaw == null ? null : Number(ageRaw));
    const student = demographics.student_status || demographics.student || null;
    const employment = demographics.employment_status || demographics.employment || null;
    await client.query(text, [pid, studyId || it.study_id || null, sex || null, country || null, (Number.isFinite(age) ? age : null), student || null, employment || null, it]);
    n++;
  }
  return n;
}

async function fetchJsonWithAuth(url, token) {
  let r = await httpFetch(url, { headers: { 'Accept': 'application/json', 'Authorization': `Token ${token}` } });
  if (!r.ok && (r.status === 401 || r.status === 403)) {
    r = await httpFetch(url, { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` } });
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    err.body = text;
    throw err;
  }
  return r.json();
}

async function syncViaSubmissions(base, studyId, token, client) {
  let page = 1;
  const pageSize = 100;
  const allPids = new Set();
  while (true) {
    const url = `${base}/studies/${encodeURIComponent(studyId)}/submissions/?page=${page}&page_size=${pageSize}`;
    let data;
    try {
      data = await fetchJsonWithAuth(url, token);
    } catch (e) {
      if (e.status === 404) break;
      throw e;
    }
    const items = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
    for (const it of items) {
      const pid = it.participant_id || it.participant || it.prolific_id || (it.participant_details && it.participant_details.id);
      if (pid) allPids.add(pid);
    }
    if (!data || !data.next) break;
    page += 1;
  }
  // Fetch demographics per participant id (best-effort)
  let upsertCount = 0;
  for (const pid of allPids) {
    try {
      const pUrl = `${base}/participants/${encodeURIComponent(pid)}/`;
      const pJson = await fetchJsonWithAuth(pUrl, token);
      // Shape into a generic item the upserter understands
      const item = { participant_id: pid, study_id: studyId, demographics: pJson || {} };
      upsertCount += await upsertProlificParticipants(client, { results: [item] }, studyId);
    } catch (_) {
      // ignore missing participants
    }
  }
  return upsertCount;
}

module.exports = {
  hasNextPage,
  upsertProlificParticipants,
  fetchJsonWithAuth,
  syncViaSubmissions
};
