const express = require('express');

const { pool, researchPool } = require('../db/pool');
const { detectDemographics, qIdent } = require('../lib/demographics');

const router = express.Router();

// Store WHO-5 and SWLS for research mode
router.post('/research', async (req, res) => {
  try {
    // Be resilient to different content-types (sendBeacon may send text/plain)
    let payload = req.body;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_) { payload = {}; }
    }
    const { sessionId, who5, swls, cantril, userAgent, prolific } = payload || {};
    if (!sessionId || !Array.isArray(who5) || !Array.isArray(swls)) {
      return res.status(400).json({ error: 'Invalid research payload' });
    }
    // Coerce Cantril to an integer when provided (accept numeric strings)
    const cantrilNumber = (cantril === null || cantril === undefined) ? null : Number(cantril);
    const cantrilValue = Number.isFinite(cantrilNumber) ? Math.round(cantrilNumber) : null;
    console.log('📥 /api/research payload', { sessionId, cantrilRaw: cantril, cantrilValue });
    const client = await researchPool.connect();
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS research_entries (
          id SERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          who5 INTEGER[] NOT NULL,
          swls INTEGER[] NOT NULL,
          cantril INTEGER,
          user_agent TEXT,
          prolific_pid TEXT,
          prolific_study_id TEXT,
          prolific_session_id TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )`
      );
      // Ensure cantril column exists for older tables
      await client.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS cantril INTEGER');
      await client.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS prolific_pid TEXT');
      await client.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS prolific_study_id TEXT');
      await client.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS prolific_session_id TEXT');
      const inserted = await client.query(
        `INSERT INTO research_entries (session_id, who5, swls, cantril, user_agent, prolific_pid, prolific_study_id, prolific_session_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, cantril`,
        [sessionId, who5, swls, cantrilValue, userAgent || null, prolific?.PROLIFIC_PID || null, prolific?.STUDY_ID || null, prolific?.SESSION_ID || null]
      );
      console.log('✅ Research saved', inserted.rows[0]);
      res.status(201).json({ message: 'Research saved', cantril: inserted.rows[0]?.cantril ?? cantrilValue });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error saving research:', e);
    res.status(500).json({ error: 'Failed to save research' });
  }
});

// Query research results (latest N, or by date range)
router.get('/research-results', async (req, res) => {
  try {
    const { limit = 700, from, to, includeNoIhs, includeScanDetails, sex, country, countries, ageMin, ageMax, excludeCountries } = req.query;
    const client = await researchPool.connect();
    const mainClient = await pool.connect();
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS research_entries (
          id SERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          who5 INTEGER[] NOT NULL,
          swls INTEGER[] NOT NULL,
          cantril INTEGER,
          user_agent TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        )`
      );
      // Ensure cantril column exists for older tables
      await client.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS cantril INTEGER');
      // Demographics join (dynamic table/column detection)
      const demo = await detectDemographics(mainClient);
      const demoSelect = demo ? `, d.${qIdent(demo.sexCol || 'sex')} AS demo_sex, d.${qIdent(demo.ageCol || 'age')} AS demo_age, d.${qIdent(demo.countryCol || 'country_of_residence')} AS demo_country` : '';
      const demoJoin = demo ? ` LEFT JOIN ${qIdent(demo.table)} d ON d.${qIdent(demo.pidCol)} = re.prolific_pid` : '';
      let query = `SELECT re.id, re.session_id, re.who5, re.swls, re.cantril, re.user_agent, re.created_at,
                          re.prolific_pid, re.prolific_study_id, re.prolific_session_id${demoSelect}
                   FROM research_entries re${demoJoin}`;
      const params = [];
      const clauses = [];
      if (from) { params.push(from); clauses.push(`created_at >= $${params.length}`); }
      if (to) { params.push(to); clauses.push(`created_at <= $${params.length}`); }
      if (demo && sex) { params.push(String(sex)); clauses.push(`LOWER(d.${qIdent(demo.sexCol || 'sex')}) = LOWER($${params.length})`); }
      if (demo && country) { params.push(String(country)); clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) = LOWER($${params.length})`); }
      if (demo && countries) {
        const inc = String(countries).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (inc.length) {
          const placeholders = inc.map((_, i) => `LOWER($${params.length + i + 1})`).join(',');
          params.push(...inc);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) IN (${placeholders})`);
        }
      }
      if (demo && excludeCountries) {
        const ex = String(excludeCountries).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (ex.length) {
          const loweredPlaceholders = ex.map((_, i) => `LOWER($${params.length + i + 1})`).join(',');
          params.push(...ex);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) NOT IN (${loweredPlaceholders})`);
        }
      }
      if (demo && ageMin) { params.push(Number(ageMin)); clauses.push(`d.${qIdent(demo.ageCol || 'age')} >= $${params.length}`); }
      if (demo && ageMax) { params.push(Number(ageMax)); clauses.push(`d.${qIdent(demo.ageCol || 'age')} <= $${params.length}`); }
      if (clauses.length) query += ' WHERE ' + clauses.join(' AND ');
      params.push(Math.min(parseInt(limit, 10) || 700, 1500));
      query += ` ORDER BY re.created_at DESC LIMIT $${params.length}`;
      const result = await client.query(query, params);

      // Fetch IHS per session_id from main DB and merge
      const entries = result.rows || [];
      const sessionIds = entries.map(e => e.session_id).filter(Boolean);
      let ihsMap = new Map();
      if (sessionIds.length) {
        // Use ANY(array) to avoid overly large IN clause
        const ihsRows = await mainClient.query(
          `SELECT session_id, ihs_score, n1_score, n2_score, n3_score, n1_scaled_100, n1_trials_total, user_agent, card_selections, completion_time, selected_count, rejected_count
           FROM scan_responses WHERE session_id = ANY($1::text[])`,
          [sessionIds]
        );
        ihsMap = new Map(ihsRows.rows.map(r => [r.session_id, {
          ihs: r.ihs_score,
          n1: r.n1_scaled_100 != null ? r.n1_scaled_100 : r.n1_score,
          n2: r.n2_score,
          n3: r.n3_score,
          scan_user_agent: r.user_agent || null,
          selections: r.card_selections || null,
          completion_time: r.completion_time == null ? null : Number(r.completion_time),
          selected_count: r.selected_count == null ? null : Number(r.selected_count),
          rejected_count: r.rejected_count == null ? null : Number(r.rejected_count)
        }]));
      }
      let merged = entries.map(e => {
        const s = ihsMap.get(e.session_id) || {};
        const base = {
          ...e,
          ihs: s.ihs ?? null,
          n1: s.n1 ?? null,
          n2: s.n2 ?? null,
          n3: s.n3 ?? null
        };
        // Include heavy scan details only when requested
        const wantScan = String(includeScanDetails).toLowerCase() === 'true';
        if (wantScan) {
          base.scan_user_agent = s.scan_user_agent ?? null;
          base.selections = s.selections ?? null;
          base.completion_time = s.completion_time ?? null;
        }
        return base;
      });
      // By default, only include rows that have an IHS score to avoid counting pre-scan refreshes
      const shouldIncludeNoIhs = String(includeNoIhs).toLowerCase() === 'true';
      if (!shouldIncludeNoIhs) {
        merged = merged.filter(e => e.ihs !== null && !Number.isNaN(Number(e.ihs)));
      }
      res.json({ count: merged.length, entries: merged });
    } finally {
      client.release();
      mainClient.release();
    }
  } catch (e) {
    console.error('Error fetching research results:', e);
    res.status(500).json({ error: 'Failed to fetch research results' });
  }
});

// Compare research WHO-5/SWLS with scan IHS by session
router.get('/research-compare', async (req, res) => {
  try {
    const { limit = 500 } = req.query;
    const mainClient = await pool.connect();
    const researchClient = await researchPool.connect();
    try {
      await researchClient.query(
        `CREATE TABLE IF NOT EXISTS research_entries (
          id SERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          who5 INTEGER[] NOT NULL,
          swls INTEGER[] NOT NULL,
          cantril INTEGER,
          user_agent TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        )`
      );
      await researchClient.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS cantril INTEGER');
      // Fetch recent scan results and map by session_id
      const scanRows = (await mainClient.query(
        `SELECT session_id, ihs_score, created_at FROM scan_responses 
         WHERE ihs_score IS NOT NULL AND created_at > now() - interval '7 days' 
         ORDER BY created_at DESC LIMIT $1`, [Math.min(parseInt(limit, 10) || 500, 2000)])).rows;
      const bySession = new Map();
      for (const r of scanRows) bySession.set(r.session_id, r);

      // Fetch research entries that have matching session_ids
      const sessions = scanRows.map(r => r.session_id).filter(Boolean);
      let researchRows = [];
      if (sessions.length) {
        const chunks = [];
        for (let i = 0; i < sessions.length; i += 500) chunks.push(sessions.slice(i, i + 500));
        for (const chunk of chunks) {
          const params = chunk.map((_, i) => `$${i + 1}`).join(',');
          const { rows } = await researchClient.query(
            `SELECT session_id, who5, swls, cantril, created_at FROM research_entries WHERE session_id IN (${params})`, chunk);
          researchRows = researchRows.concat(rows);
        }
      }

      // Join
      const joined = researchRows.map(r => ({
        session_id: r.session_id,
        who5: r.who5,
        swls: r.swls,
        cantril: r.cantril,
        ihs: bySession.get(r.session_id)?.ihs_score ?? null,
        scan_created_at: bySession.get(r.session_id)?.created_at ?? null,
        research_created_at: r.created_at
      })).filter(j => j.ihs !== null);

      res.json({ count: joined.length, entries: joined });
    } finally {
      mainClient.release();
      researchClient.release();
    }
  } catch (e) {
    console.error('Error building research comparison:', e);
    res.status(500).json({ error: 'Failed to build comparison' });
  }
});

// Export latest joined research+scan entries as CSV
router.get('/research-entries.csv', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || '1000'), 10) || 1000, 5000);
    const researchClient = await researchPool.connect();
    const mainClient = await pool.connect();
    try {
      await researchClient.query(
        `CREATE TABLE IF NOT EXISTS research_entries (
          id SERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          who5 INTEGER[] NOT NULL,
          swls INTEGER[] NOT NULL,
          cantril INTEGER,
          user_agent TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        )`
      );

      // Include demographics if available
      const demo = await detectDemographics(researchClient);
      const demoJoin = demo ? ` LEFT JOIN ${qIdent(demo.table)} d ON d.${qIdent(demo.pidCol)} = re.prolific_pid` : '';
      const demoSelect = demo ? `, d.${qIdent(demo.sexCol || 'sex')} AS demo_sex, d.${qIdent(demo.ageCol || 'age')} AS demo_age, d.${qIdent(demo.countryCol || 'country_of_residence')} AS demo_country` : `, NULL::text AS demo_sex, NULL::int AS demo_age, NULL::text AS demo_country`;
      const { rows: researchRows } = await researchClient.query(
        `SELECT re.session_id, re.who5, re.swls, re.cantril, re.user_agent, re.created_at${demoSelect}
         FROM research_entries re${demoJoin}
         ORDER BY re.created_at DESC
         LIMIT $1`, [limit]
      );

      const sessions = researchRows.map(r => r.session_id).filter(Boolean);
      let scanRows = [];
      if (sessions.length) {
        const chunks = [];
        for (let i = 0; i < sessions.length; i += 500) chunks.push(sessions.slice(i, i + 500));
        for (const chunk of chunks) {
          const params = chunk.map((_, i) => `$${i + 1}`).join(',');
          const { rows } = await mainClient.query(
            `SELECT session_id, ihs_score, n1_score, n2_score, n3_score, n1_scaled_100, n1_trials_total, n1_version, completion_time, selected_count, rejected_count, card_selections, user_agent, created_at
             FROM scan_responses WHERE session_id IN (${params})`, chunk
          );
          scanRows = scanRows.concat(rows);
        }
      }

      const bySessionScan = new Map(scanRows.map(r => [r.session_id, r]));

      function sumArray(arr) { return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0); }
      function isMobileUA(ua) { return /(Mobi|Android|iPhone|iPad|iPod)/i.test(String(ua || '')); }
      function csvEscape(v) {
        if (v == null) return '';
        const s = String(v);
        if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      }

      const header = [
        'session_id', 'research_created_at', 'who5_total', 'swls_total', 'cantril',
        'sex', 'age', 'country',
        'ihs', 'n1_legacy', 'n2', 'n3', 'n1_scaled_100', 'n1_trials_total', 'n1_version', 'scan_created_at', 'device', 'scan_user_agent',
        'completion_time_ms', 'selected_count', 'rejected_count', 'yes_count', 'no_count', 'timeouts',
        'mod_click', 'mod_swipe', 'mod_arrow'
      ];
      const lines = [header.join(',')];

      for (const r of researchRows) {
        const s = bySessionScan.get(r.session_id) || {};
        const selections = s.card_selections || {};
        const all = Array.isArray(selections.allResponses) ? selections.allResponses : [];
        let yes = 0, no = 0, timeouts = 0;
        let mc = 0, ms = 0, ma = 0;
        for (const e of all) {
          if (!e) continue;
          if (e.response === true) yes++; else if (e.response === false) no++; else if (e.response === null) timeouts++;
          const m = String(e.inputModality || '').toLowerCase();
          if (m === 'click') mc++; else if (m === 'swipe-touch' || m === 'swipe-mouse') ms++; else if (m === 'keyboard-arrow') ma++;
        }
        const row = [
          r.session_id,
          r.created_at?.toISOString?.() || r.created_at,
          sumArray(r.who5),
          sumArray(r.swls),
          (r.cantril == null ? '' : Number(r.cantril)),
          (r.demo_sex == null ? '' : String(r.demo_sex)),
          (r.demo_age == null ? '' : Number(r.demo_age)),
          (r.demo_country == null ? '' : String(r.demo_country)),
          (s.ihs_score == null ? '' : Number(s.ihs_score)),
          (s.n1_score == null ? '' : Number(s.n1_score)),
          (s.n2_score == null ? '' : Number(s.n2_score)),
          (s.n3_score == null ? '' : Number(s.n3_score)),
          (s.n1_scaled_100 == null ? '' : Number(s.n1_scaled_100)),
          (s.n1_trials_total == null ? '' : Number(s.n1_trials_total)),
          (s.n1_version == null ? '' : Number(s.n1_version)),
          s.created_at?.toISOString?.() || s.created_at || '',
          (isMobileUA(s.user_agent) ? 'Mobile' : 'Desktop'),
          s.user_agent || '',
          (s.completion_time == null ? '' : Number(s.completion_time)),
          (s.selected_count == null ? '' : Number(s.selected_count)),
          (s.rejected_count == null ? '' : Number(s.rejected_count)),
          yes, no, timeouts,
          mc, ms, ma
        ].map(csvEscape).join(',');
        lines.push(row);
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="latest_entries.csv"');
      res.send(lines.join('\n'));
    } finally {
      researchClient.release();
      mainClient.release();
    }
  } catch (e) {
    console.error('Error exporting research entries CSV:', e);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

module.exports = router;
