const express = require('express');

const { pool } = require('../db/pool');
const {
  fetchJsonWithAuth,
  upsertProlificParticipants,
  syncViaSubmissions,
  hasNextPage
} = require('../lib/prolific');

const router = express.Router();

// Sync demographics from Prolific API for a given study
// ENV required: PROLIFIC_API_TOKEN; optional: PROLIFIC_API_BASE (defaults to v1)
router.post('/sync', async (req, res) => {
  try {
    const studyId = String(req.body?.study_id || req.query.study_id || '').trim();
    if (!studyId) return res.status(400).json({ error: 'study_id required' });
    const token = process.env.PROLIFIC_API_TOKEN;
    if (!token) return res.status(400).json({ error: 'PROLIFIC_API_TOKEN not set' });
    const base = (process.env.PROLIFIC_API_BASE || 'https://api.prolific.com/api/v1').replace(/\/$/, '');

    const client = await pool.connect();
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS prolific_participants (
          prolific_pid TEXT PRIMARY KEY,
          study_id TEXT,
          sex TEXT,
          country_of_residence TEXT,
          age INTEGER,
          student_status TEXT,
          employment_status TEXT,
          raw JSONB,
          updated_at TIMESTAMPTZ DEFAULT now()
        )`
      );

      let totalUpserted = 0;
      // Try primary endpoint
      try {
        let page = 1;
        const pageSize = 200;
        while (true) {
          const url = `${base}/studies/${encodeURIComponent(studyId)}/participants/?page=${page}&page_size=${pageSize}`;
          const data = await fetchJsonWithAuth(url, token);
          const count = await upsertProlificParticipants(client, data, studyId);
          totalUpserted += count;
          if (!hasNextPage(data)) break;
          page += 1;
        }
      } catch (e) {
        if (e.status === 404) {
          // Fallback to submissions + per-participant fetch for private/inactive studies
          const extra = await syncViaSubmissions(base, studyId, token, client);
          totalUpserted += extra;
        } else {
          throw e;
        }
      }
      res.json({ ok: true, study_id: studyId, upserted: totalUpserted });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error syncing Prolific participants', e);
    res.status(500).json({ error: 'Failed to sync from Prolific' });
  }
});

module.exports = router;
