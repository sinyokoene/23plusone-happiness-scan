require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');
// Use global fetch if available (Node 18+); otherwise lazy-load node-fetch
const httpFetch = (typeof fetch !== 'undefined') ? fetch : (url, opts) => import('node-fetch').then(m => m.default(url, opts));

// Force deployment update - Complete data structure fix
const app = express();

// CORS configuration for iframe embedding
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Remove X-Frame-Options to allow iframe embedding
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  next();
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));
// Sync demographics from Prolific API for a given study
// ENV required: PROLIFIC_API_TOKEN; optional: PROLIFIC_API_BASE (defaults to v1)
app.post('/api/prolific/sync', async (req, res) => {
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
        let page = 1; const pageSize = 200;
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
    } finally { client.release(); }
  } catch (e) {
    console.error('Error syncing Prolific participants', e);
    res.status(500).json({ error: 'Failed to sync from Prolific' });
  }
});

function hasNextPage(apiResponse){
  // Support v1 pagination { results:[], next: url|null } or array fallback
  if (!apiResponse) return false;
  if (Array.isArray(apiResponse)) return false;
  if (typeof apiResponse.next !== 'undefined') return !!apiResponse.next;
  // Some APIs use count/results with page; if fewer than page size, assume no next
  if (Array.isArray(apiResponse.results)) return false; // we handle via explicit 'next'
  return false;
}

async function upsertProlificParticipants(client, apiResponse, studyId){
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
    const age = (ageRaw==null ? null : Number(ageRaw));
    const student = demographics.student_status || demographics.student || null;
    const employment = demographics.employment_status || demographics.employment || null;
    await client.query(text, [pid, studyId || it.study_id || null, sex || null, country || null, (Number.isFinite(age)?age:null), student || null, employment || null, it]);
    n++;
  }
  return n;
}

async function fetchJsonWithAuth(url, token){
  let r = await httpFetch(url, { headers: { 'Accept': 'application/json', 'Authorization': `Token ${token}` } });
  if (!r.ok && (r.status === 401 || r.status === 403)) {
    r = await httpFetch(url, { headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` } });
  }
  if (!r.ok) {
    const text = await r.text().catch(()=> '');
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status; err.body = text; throw err;
  }
  return r.json();
}

async function syncViaSubmissions(base, studyId, token, client){
  let page = 1; const pageSize = 100; let allPids = new Set();
  while (true) {
    const url = `${base}/studies/${encodeURIComponent(studyId)}/submissions/?page=${page}&page_size=${pageSize}`;
    let data;
    try { data = await fetchJsonWithAuth(url, token); } catch (e) {
      if (e.status === 404) break; else throw e;
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
// Removed demographics upsert endpoint per request - we'll handle CSV offline and import differently

// Database connection pool with robust env detection
function resolveDatabaseUrl() {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.SUPABASE_DB_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRESQL_URL,
    process.env.DB_URL
  ];
  for (const url of candidates) {
    if (url && typeof url === 'string' && url.trim().length > 0) return url.trim();
  }
  return 'postgresql://sinyo@localhost:5432/happiness_benchmark';
}

const resolvedDbUrl = resolveDatabaseUrl();
const isSupabase = /supabase\.co|supabase\.in/i.test(resolvedDbUrl);

const pool = new Pool({
  connectionString: resolvedDbUrl,
  ssl: (process.env.NODE_ENV === 'production' || isSupabase) ? { rejectUnauthorized: false } : false
});
// Optional separate research DB (falls back to main if not provided)
const researchDbUrl = process.env.RESEARCH_DATABASE_URL || resolvedDbUrl;
const researchPool = new Pool({
  connectionString: researchDbUrl,
  ssl: (process.env.NODE_ENV === 'production' || /supabase\.co|supabase\.in/i.test(researchDbUrl)) ? { rejectUnauthorized: false } : false
});


console.log('🔌 DB URL source resolved:', resolvedDbUrl ? 'set' : 'missing');

// One-time startup migration: drop deprecated ip_address column if present
async function dropIpAddressColumnIfExists() {
  try {
    const client = await pool.connect();
    try {
      await client.query('ALTER TABLE scan_responses DROP COLUMN IF EXISTS ip_address');
      console.log('🧹 Dropped ip_address column if it existed');
    } finally {
      client.release();
    }
  } catch (e) {
    console.warn('Startup migration: could not drop ip_address column', e?.message || e);
  }
}
dropIpAddressColumnIfExists();

// Basic abuse controls (configurable via env)
// 0 means "ever" (reject any duplicate session_id)
const DUPLICATE_SESSION_WINDOW_MIN = process.env.DUPLICATE_SESSION_WINDOW_MIN === undefined
  ? 0
  : parseInt(process.env.DUPLICATE_SESSION_WINDOW_MIN, 10);

async function isDuplicateSession(client, sessionId) {
  if (!sessionId) return false;
  const windowSql = DUPLICATE_SESSION_WINDOW_MIN > 0
    ? `AND created_at > now() - interval '${DUPLICATE_SESSION_WINDOW_MIN} minutes'`
    : '';
  const { rows } = await client.query(
    `SELECT 1 FROM scan_responses WHERE session_id = $1 ${windowSql} LIMIT 1`,
    [sessionId]
  );
  return rows.length > 0;
}

// Removed IP-based rate limiting and storage

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env_check: process.env.DATABASE_URL ? 'DB_URL_SET' : 'DB_URL_MISSING'
  });
});

// Create a transport for sending emails. Supports SMTP URL in EMAIL_SMTP_URL or Gmail creds
function buildTransport() {
  if (process.env.EMAIL_SMTP_URL) {
    return nodemailer.createTransport(process.env.EMAIL_SMTP_URL);
  }
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  // Fallback to json transport in dev so requests succeed
  return nodemailer.createTransport({ jsonTransport: true });
}

// All PDF rendering is handled client-side. Server only accepts provided pdfBase64.

// Request full report: generates a PDF from HTML report and emails it
app.post('/api/report', async (req, res) => {
  try {
    const { email, sessionId, results, marketing } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // Optional: fetch benchmark context for the report
    let benchmark = null;
    try {
      const client = await pool.connect();
      try {
        const ihs = typeof results?.ihs === 'number' ? results.ihs : null;
        if (ihs != null) {
          const ihsResult = await client.query(
            `SELECT COUNT(*) as total, COUNT(CASE WHEN ihs_score < $1 THEN 1 END) as lower FROM scan_responses WHERE ihs_score IS NOT NULL`, [ihs]
          );
          const total = parseInt(ihsResult.rows[0].total || 0);
          const lower = parseInt(ihsResult.rows[0].lower || 0);
          const percentile = total > 0 ? Math.round((lower / total) * 100) : 0;
          const ctx = await client.query(`SELECT AVG(ihs_score) as avg_ihs FROM scan_responses WHERE ihs_score IS NOT NULL`);
          benchmark = { ihsPercentile: percentile, context: { averageScore: ctx.rows[0].avg_ihs ? Math.round(parseFloat(ctx.rows[0].avg_ihs) * 10) / 10 : null } };
        }
      } finally { client.release(); }
    } catch(_) {}

    // Require client-provided PDF to keep server simple/free
    const pdfBase64 = typeof req.body?.pdfBase64 === 'string' ? req.body.pdfBase64 : null;
    if (!pdfBase64) {
      return res.status(400).json({ error: 'Missing pdfBase64' });
    }
    let pdfBuffer;
    try {
      const base64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      pdfBuffer = Buffer.from(base64, 'base64');
    } catch(_) {
      return res.status(400).json({ error: 'Invalid pdfBase64' });
    }

    // Send email
    const from = process.env.MAIL_FROM || 'no-reply@23plusone.org';
    const transport = buildTransport();
    const info = await transport.sendMail({
      from,
      to: email,
      subject: 'Your 23plusone Drive Profile Report',
      text: 'Attached is your drive profile report. Thank you for taking the 23plusone scan!',
      attachments: [{ filename: '23plusone-report.pdf', content: pdfBuffer }]
    });

    // Optionally store marketing opt-in; simple log for now
    try { if (marketing) console.log('Marketing opt-in from', email, sessionId || 'n/a'); } catch(_) {}

    res.json({ ok: true, messageId: info?.messageId || null });
  } catch (e) {
    console.error('Error sending report:', e);
    const debug = String(process.env.DEBUG_REPORT || '').toLowerCase() === '1' || String(process.env.NODE_ENV).toLowerCase() !== 'production';
    if (debug) {
      res.status(500).json({ error: 'Failed to send report', message: e?.message || null, stack: e?.stack || null });
    } else {
      res.status(500).json({ error: 'Failed to send report' });
    }
  }
});

// Preview route: render report HTML with provided base64 data
app.get('/report/preview', (req, res) => {
  // serve static file; client-side script reads ?data=
  res.sendFile(path.join(__dirname, '../public/report.html'));
});

// Build payload for report by sessionId (for preview without base64)
app.get('/api/report-payload', async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const client = await pool.connect();
    try {
      const row = (await client.query(
        `SELECT ihs_score, n1_score, n2_score, n3_score, completion_time, card_selections
         FROM scan_responses WHERE session_id = $1 ORDER BY id DESC LIMIT 1`, [sessionId]
      )).rows?.[0];
      if (!row) return res.status(404).json({ error: 'Not found' });
      const selections = row.card_selections || {};
      const all = Array.isArray(selections.allResponses) ? selections.allResponses : [];
      const domainAffirmations = {};
      let unansweredCount = 0;
      for (const e of all) {
        if (e && e.response === null) unansweredCount++;
        const aff = e && e.affirmationScore;
        const d = e && e.domain;
        const val = (aff == null ? null : Number(aff));
        if (d && val != null && !Number.isNaN(val) && val > 0) {
          domainAffirmations[d] = (domainAffirmations[d] || 0) + val;
        }
      }
      // Benchmark context
      let benchmark = null;
      try {
        const ihs = row.ihs_score == null ? null : Number(row.ihs_score);
        if (ihs != null) {
          const ihsResult = await client.query(
            `SELECT COUNT(*) as total, COUNT(CASE WHEN ihs_score < $1 THEN 1 END) as lower FROM scan_responses WHERE ihs_score IS NOT NULL`, [ihs]
          );
          const total = parseInt(ihsResult.rows[0].total || 0);
          const lower = parseInt(ihsResult.rows[0].lower || 0);
          const percentile = total > 0 ? Math.round((lower / total) * 100) : 0;
          const ctx = await client.query(`SELECT AVG(ihs_score) as avg_ihs FROM scan_responses WHERE ihs_score IS NOT NULL`);
          benchmark = { ihsPercentile: percentile, context: { averageScore: ctx.rows[0].avg_ihs ? Math.round(parseFloat(ctx.rows[0].avg_ihs) * 10) / 10 : null } };
        }
      } catch (_) {}
      const payload = {
        results: {
          ihs: row.ihs_score == null ? null : Number(row.ihs_score),
          n1: row.n1_score == null ? null : Number(row.n1_score),
          n2: row.n2_score == null ? null : Number(row.n2_score),
          n3: row.n3_score == null ? null : Number(row.n3_score),
          domainAffirmations
        },
        completionTime: row.completion_time == null ? null : Number(row.completion_time),
        unansweredCount,
        benchmark
      };
      res.json(payload);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error building report payload:', e);
    res.status(500).json({ error: 'Failed to build payload' });
  }
});

// Debug endpoint to check database connection
app.get('/api/debug', async (req, res) => {
  try {
    const hasDbUrl = !!process.env.DATABASE_URL;
    const dbUrlLength = process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0;
    const dbUrlPrefix = process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 20) + '...' : 'Not set';
    
    if (!hasDbUrl) {
      return res.json({
        status: 'error',
        message: 'DATABASE_URL not set',
        hasDbUrl,
        dbUrlLength,
        dbUrlPrefix
      });
    }

    // Try to connect to database
    const client = await pool.connect();
    const result = await client.query('SELECT COUNT(*) FROM scan_responses');
    client.release();
    
    res.json({
      status: 'success',
      message: 'Database connection working',
      hasDbUrl,
      dbUrlLength,
      dbUrlPrefix,
      responseCount: result.rows[0].count
    });
  } catch (err) {
    res.json({
      status: 'error',
      message: 'Database connection failed',
      error: err.message,
      hasDbUrl: !!process.env.DATABASE_URL,
      dbUrlLength: process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0,
      dbUrlPrefix: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 20) + '...' : 'Not set'
    });
  }
});

// Validation function to prevent spam and invalid responses
function validateScanQuality(cardSelections, completionTime) {
  console.log('🔍 Validating scan:', {
    hasCardSelections: !!cardSelections,
    hasAllResponses: !!cardSelections?.allResponses,
    isArray: Array.isArray(cardSelections?.allResponses),
    responsesLength: cardSelections?.allResponses?.length,
    selectedLength: cardSelections?.selected?.length,
    completionTime
  });

  // Check if we have the required data structure
  if (!cardSelections || !cardSelections.allResponses || !Array.isArray(cardSelections.allResponses)) {
    console.log('❌ Missing response data structure');
    return { isValid: false, reason: 'Missing response data' };
  }
  
  const responses = cardSelections.allResponses;
  const selectedCount = cardSelections.selected?.length || 0;
  const totalResponses = responses.length;
  const nullCount = responses.filter(r => r.response === null).length;
  
  console.log('📊 Scan details:', {
    totalResponses,
    selectedCount,
    nullCount,
    completionTime: `${completionTime}s`
  });
  
  // Must have 24 responses (full scan)
  if (totalResponses !== 24) {
    console.log('❌ Incomplete scan');
    return { isValid: false, reason: `Incomplete scan: ${totalResponses}/24 responses` };
  }
  
  // Reject all "No" responses (0 selected) - clearly not engaging
  if (selectedCount === 0) {
    console.log('❌ All No responses');
    return { isValid: false, reason: 'All responses were "No" - likely not engaging properly' };
  }
  
  // Accept all "Yes" responses (24 selected). Retain as a soft signal only.
  if (selectedCount === 24) {
    console.log('ℹ️ All Yes responses: accepted');
    // Do not reject; allow storing this case for analysis
  }
  
  // Too many unanswered (NULL) responses
  if (nullCount > 3) {
    console.log('❌ Too many unanswered cards (NULL responses)');
    return { isValid: false, reason: 'Too many unanswered cards' };
  }
  
  // Allow fast individual clicks but prevent completing entire scan too quickly
  // Someone can click very fast on each card, but completing all 24 cards in under 5s is suspicious
  if (completionTime && completionTime < 5) {
    console.log('❌ Too fast completion');
    return { isValid: false, reason: `Scan completed too quickly: ${completionTime}s (minimum 5s for 24 cards)` };
  }
  
  console.log('✅ Validation passed');
  // All validation passed - allow normal human variations in speed
  return { isValid: true, reason: 'Valid response' };
}

// Post a scan response
app.post('/api/responses', async (req, res) => {
  try {
    const { sessionId, cardSelections, ihsScore, n1Score, n2Score, n3Score, completionTime, userAgent } = req.body;
    
    // Basic validation
    if (!sessionId || !cardSelections || typeof ihsScore !== 'number') {
      return res.status(400).json({ error: 'Invalid request format' });
    }
    
    // Quality validation to prevent spam/invalid responses
    const validationResult = validateScanQuality(cardSelections, completionTime);
    if (!validationResult.isValid) {
      console.log(`🚫 Rejected submission: ${validationResult.reason}`, { sessionId, completionTime });
      return res.status(400).json({ 
        error: 'Invalid scan submission',
        reason: validationResult.reason
      });
    }
    
    const client = await pool.connect();
    
    try {
      // Duplicate session protection
      if (await isDuplicateSession(client, sessionId)) {
        return res.status(409).json({ error: 'Duplicate submission', reason: 'Session already submitted' });
      }
      // Insert scan response (IP column removed)
      const result = await client.query(
        `INSERT INTO scan_responses 
         (session_id, card_selections, ihs_score, n1_score, n2_score, n3_score, completion_time, user_agent, selected_count, rejected_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          sessionId, 
          JSON.stringify(cardSelections), 
          ihsScore,
          n1Score || 0,
          n2Score || 0, 
          n3Score || 0,
          completionTime || 0,
          userAgent || null,
          cardSelections?.selected?.length || 0,
          cardSelections?.rejected?.length || 0
        ]
      );
      
      console.log(`✅ Valid scan saved: ${sessionId} (${cardSelections.selected?.length || 0} selected)`);
      
      res.status(201).json({ 
        message: 'Response saved successfully',
        id: result.rows[0].id 
      });
      
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error('Error saving response:', err);
    res.status(500).json({ error: 'Failed to save response' });
  }
});

// Store WHO-5 and SWLS for research mode
app.post('/api/research', async (req, res) => {
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
app.get('/api/research-results', async (req, res) => {
  try {
    const { limit = 700, from, to, includeNoIhs, includeScanDetails, sex, country, ageMin, ageMax } = req.query;
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
      let query = `SELECT re.id, re.session_id, re.who5, re.swls, re.cantril, re.user_agent, re.created_at,
                          re.prolific_pid, re.prolific_study_id, re.prolific_session_id,
                          pp.sex AS demo_sex, pp.age AS demo_age, pp.country_of_residence AS demo_country
                   FROM research_entries re
                   LEFT JOIN prolific_participants pp ON pp.prolific_pid = re.prolific_pid`;
      const params = [];
      const clauses = [];
      if (from) { params.push(from); clauses.push(`created_at >= $${params.length}`); }
      if (to) { params.push(to); clauses.push(`created_at <= $${params.length}`); }
      if (sex) { params.push(sex); clauses.push(`pp.sex = $${params.length}`); }
      if (country) { params.push(country); clauses.push(`pp.country_of_residence = $${params.length}`); }
      if (ageMin) { params.push(Number(ageMin)); clauses.push(`pp.age >= $${params.length}`); }
      if (ageMax) { params.push(Number(ageMax)); clauses.push(`pp.age <= $${params.length}`); }
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
          `SELECT session_id, ihs_score, n1_score, n2_score, n3_score, user_agent, card_selections, completion_time, selected_count, rejected_count
           FROM scan_responses WHERE session_id = ANY($1::text[])`,
          [sessionIds]
        );
        ihsMap = new Map(ihsRows.rows.map(r => [r.session_id, {
          ihs: r.ihs_score,
          n1: r.n1_score,
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

// Correlations across scan and research data
app.get('/api/analytics/correlations', async (req, res) => {
  function sumArray(arr) {
    return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
  }
  function pearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return { r: 0, n: n };
    const xs = x.slice(0, n);
    const ys = y.slice(0, n);
    const xm = xs.reduce((a, b) => a + b, 0) / n;
    const ym = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const xv = xs[i] - xm;
      const yv = ys[i] - ym;
      num += xv * yv;
      dx += xv * xv;
      dy += yv * yv;
    }
    const denom = Math.sqrt(dx * dy);
    return { r: denom ? (num / denom) : 0, n };
  }

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const device = String(req.query.device || '').toLowerCase(); // 'mobile' | 'desktop' | ''
    const modality = String(req.query.modality || '').toLowerCase(); // 'click' | 'swipe' | 'arrow' | ''
    const exclusive = String(req.query.exclusive || '').toLowerCase() === 'true';
    const excludeTimeouts = String(req.query.excludeTimeouts || '').toLowerCase() === 'true';
    const threshold = Number.isFinite(Number(req.query.threshold)) ? Number(req.query.threshold) : null; // 0..100
    const researchClient = await researchPool.connect();
    const mainClient = await pool.connect();
    try {
      // Ensure table exists (for local dev safety)
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

      // Pull latest research rows
      const { rows: researchRows } = await researchClient.query(
        `SELECT session_id, who5, swls, cantril, created_at
         FROM research_entries
         ORDER BY created_at DESC
         LIMIT $1`, [limit]
      );
      const rBySession = new Map();
      for (const r of researchRows) {
        const who5Total = sumArray(r.who5);
        const swlsTotal = sumArray(r.swls);
        const who5Percent = who5Total * 4; // 0-25 -> 0-100
        const swlsScaled = swlsTotal * (5 / 3); // 3-21 -> 5-35 (approx scaling)
        rBySession.set(r.session_id, {
          who5Total,
          swlsTotal,
          who5Percent,
          swlsScaled,
          cantril: (r.cantril == null ? null : Number(r.cantril))
        });
      }

      const sessionIds = Array.from(rBySession.keys());
      if (!sessionIds.length) {
        return res.json({ overall: [], domains: [], cards: [], usedSessions: 0 });
      }

      // Fetch scan data for those sessions
      const { rows: scanRows } = await mainClient.query(
        `SELECT session_id, ihs_score, n1_score, n2_score, n3_score, card_selections, user_agent
         FROM scan_responses
         WHERE session_id = ANY($1::text[])`, [sessionIds]
      );

      // Keep only sessions that exist in both sets and have IHS
      let joined = [];
      for (const s of scanRows) {
        const r = rBySession.get(s.session_id);
        if (!r) continue;
        if (s.ihs_score == null) continue;
        joined.push({
          sessionId: s.session_id,
          ihs: Number(s.ihs_score),
          n1: s.n1_score == null ? null : Number(s.n1_score),
          n2: s.n2_score == null ? null : Number(s.n2_score),
          n3: s.n3_score == null ? null : Number(s.n3_score),
          who5Percent: r.who5Percent,
          swlsScaled: r.swlsScaled,
          cantril: r.cantril,
          selections: s.card_selections,
          scan_user_agent: s.user_agent || null
        });
      }

      // Optional filtering by device and modality
      function isMobileUA(ua) {
        if (!ua || typeof ua !== 'string') return false;
        return /(Mobi|Android|iPhone|iPad|iPod)/i.test(ua);
      }
      if (device === 'mobile') {
        joined = joined.filter(j => isMobileUA(j.scan_user_agent));
      } else if (device === 'desktop') {
        joined = joined.filter(j => !isMobileUA(j.scan_user_agent));
      }
      if (modality || exclusive || excludeTimeouts || (threshold != null)) {
        const matchers = {
          click: (m) => m === 'click',
          swipe: (m) => m === 'swipe-touch' || m === 'swipe-mouse',
          arrow: (m) => m === 'keyboard-arrow'
        };
        joined = joined.filter(j => {
          const all = j.selections?.allResponses;
          if (!Array.isArray(all)) return false;
          let counts = { click:0, swipe:0, arrow:0, other:0, total:0 };
          for (const e of all) {
            const v = String(e?.inputModality || '').toLowerCase();
            if (matchers.click(v)) counts.click++; else if (matchers.swipe(v)) counts.swipe++; else if (matchers.arrow(v)) counts.arrow++; else counts.other++;
            counts.total++;
          }
          if (excludeTimeouts) {
            if (all.some(e => e && e.response === null)) return false;
          }
          // modality presence (any)
          if (modality) {
            if (modality === 'click' && counts.click === 0) return false;
            if (modality === 'swipe' && counts.swipe === 0) return false;
            if (modality === 'arrow' && counts.arrow === 0) return false;
          }
          // exclusivity
          if (exclusive) {
            const present = [counts.click>0, counts.swipe>0, counts.arrow>0].filter(Boolean).length;
            if (present !== 1) return false;
          }
          // threshold
          if (threshold != null && counts.total > 0 && modality) {
            const frac = (modality === 'click' ? counts.click : modality === 'swipe' ? counts.swipe : counts.arrow) / counts.total;
            if ((frac * 100) < threshold) return false;
          }
          return true;
        });
      }

      // Helper: build aligned arrays ignoring nulls
      function pair(fnX, fnY) {
        const xs = [], ys = [];
        for (const j of joined) {
          const x = fnX(j);
          const y = fnY(j);
          if (x != null && y != null && !Number.isNaN(x) && !Number.isNaN(y)) {
            xs.push(Number(x));
            ys.push(Number(y));
          }
        }
        return { xs, ys };
      }

      // Overall correlations
      const overall = [];
      const combos = [
        { xKey: 'ihs', yKey: 'who5Percent' },
        { xKey: 'ihs', yKey: 'swlsScaled' },
        { xKey: 'ihs', yKey: 'cantril' },
        { xKey: 'n1', yKey: 'who5Percent' },
        { xKey: 'n2', yKey: 'who5Percent' },
        { xKey: 'n3', yKey: 'who5Percent' },
        { xKey: 'n1', yKey: 'swlsScaled' },
        { xKey: 'n2', yKey: 'swlsScaled' },
        { xKey: 'n3', yKey: 'swlsScaled' },
        { xKey: 'n1', yKey: 'cantril' },
        { xKey: 'n2', yKey: 'cantril' },
        { xKey: 'n3', yKey: 'cantril' }
      ];
      for (const c of combos) {
        const { xs, ys } = pair(j => j[c.xKey], j => j[c.yKey]);
        const { r, n } = pearson(xs, ys);
        overall.push({ x: c.xKey, y: c.yKey, r, n });
      }

      // Domain-level correlations
      const domainNames = ['Basics', 'Self-development', 'Ambition', 'Vitality', 'Attraction'];
      const domains = [];
      for (const domain of domainNames) {
        const xAff = [], xYes = [], yWho = [], ySwls = [], yCan = [];
        for (const j of joined) {
          const all = j.selections?.allResponses;
          if (!Array.isArray(all)) continue;
          let sumAff = 0, yesCount = 0, answered = 0;
          for (const e of all) {
            if (e && e.domain === domain) {
              const a = (e.affirmationScore == null ? null : Number(e.affirmationScore));
              if (a != null && !Number.isNaN(a)) sumAff += a;
              if (e.response !== null) {
                answered += 1;
                if (e.response === true) yesCount += 1;
              }
            }
          }
          const yesRate = answered > 0 ? (yesCount / answered) : null;
          if (yesRate != null) {
            xYes.push(yesRate);
            yWho.push(j.who5Percent);
            ySwls.push(j.swlsScaled);
            yCan.push(j.cantril);
          }
          // For affirmation, allow zero if no positive values
          xAff.push(sumAff);
        }
        // Align for affirmation vs who/swls/cantril
        const affWho = pearson(xAff.filter((_,i)=>!Number.isNaN(yWho[i])), yWho.filter(v=>!Number.isNaN(v)));
        const affSwl = pearson(xAff.filter((_,i)=>!Number.isNaN(ySwls[i])), ySwls.filter(v=>!Number.isNaN(v)));
        const affCan = pearson(xAff.filter((_,i)=>!Number.isNaN(yCan[i])), yCan.filter(v=>v!=null && !Number.isNaN(v)));
        const yesWho = pearson(xYes, yWho);
        const yesSwl = pearson(xYes, ySwls);
        const yesCan = pearson(xYes.filter((_,i)=>yCan[i]!=null && !Number.isNaN(yCan[i])), yCan.filter(v=>v!=null && !Number.isNaN(v)));
        domains.push({
          domain,
          r_affirm_who5: affWho.r,
          r_affirm_swls: affSwl.r,
          r_affirm_cantril: affCan.r,
          r_yesrate_who5: yesWho.r,
          r_yesrate_swls: yesSwl.r,
          r_yesrate_cantril: yesCan.r,
          n_affirm_who5: affWho.n,
          n_affirm_swls: affSwl.n,
          n_affirm_cantril: affCan.n,
          n_yesrate_who5: yesWho.n,
          n_yesrate_swls: yesSwl.n,
          n_yesrate_cantril: yesCan.n
        });
      }

      // Card-level correlations
      const cardStats = new Map(); // cardId -> { label, yes:[], affirm:[], who:[], swls:[] }
      for (const j of joined) {
        const all = j.selections?.allResponses;
        if (!Array.isArray(all)) continue;
        for (const e of all) {
          const cid = Number(e.cardId);
          if (!Number.isFinite(cid)) continue;
          if (!cardStats.has(cid)) cardStats.set(cid, { label: e.label || null, yes: [], affirm: [], who: [], swls: [] });
          const bucket = cardStats.get(cid);
          const yesBin = e.response === true ? 1 : (e.response === false ? 0 : null);
          const aff = (e.affirmationScore == null ? null : Number(e.affirmationScore));
          if (yesBin != null) {
            bucket.yes.push(yesBin);
            bucket.who.push(j.who5Percent);
            bucket.swls.push(j.swlsScaled);
          }
          if (aff != null && !Number.isNaN(aff)) {
            bucket.affirm.push(aff);
            // align with same y arrays for simplicity
          }
        }
      }
      const cards = [];
      for (const [cardId, b] of cardStats.entries()) {
        const rYesWho = pearson(b.yes, b.who);
        const rYesSwl = pearson(b.yes, b.swls);
        const rAffWho = pearson(b.affirm, b.who.slice(0, b.affirm.length));
        const rAffSwl = pearson(b.affirm, b.swls.slice(0, b.affirm.length));
        cards.push({
          cardId,
          label: b.label,
          r_yes_who5: rYesWho.r,
          r_yes_swls: rYesSwl.r,
          r_affirm_who5: rAffWho.r,
          r_affirm_swls: rAffSwl.r,
          n_yes_who5: rYesWho.n,
          n_yes_swls: rYesSwl.n,
          n_affirm_who5: rAffWho.n,
          n_affirm_swls: rAffSwl.n
        });
      }

      res.json({ overall, domains, cards, usedSessions: joined.length });
    } finally {
      researchClient.release();
      mainClient.release();
    }
  } catch (e) {
    console.error('Error computing correlations:', e);
    res.status(500).json({ error: 'Failed to compute correlations' });
  }
});

// Compare research WHO-5/SWLS with scan IHS by session
app.get('/api/research-compare', async (req, res) => {
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
         ORDER BY created_at DESC LIMIT $1`, [Math.min(parseInt(limit,10)||500, 2000)])).rows;
      const bySession = new Map();
      for (const r of scanRows) bySession.set(r.session_id, r);

      // Fetch research entries that have matching session_ids
      const sessions = scanRows.map(r => r.session_id).filter(Boolean);
      let researchRows = [];
      if (sessions.length) {
        const chunks = [];
        for (let i=0;i<sessions.length;i+=500) chunks.push(sessions.slice(i,i+500));
        for (const chunk of chunks) {
          const params = chunk.map((_,i)=>`$${i+1}`).join(',');
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

// Get benchmark percentiles
app.get('/api/benchmarks', async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      // Check if we have enough data for meaningful percentiles
      const countResult = await client.query(
        'SELECT COUNT(*) as response_count FROM scan_responses'
      );
      
      const responseCount = parseInt(countResult.rows[0].response_count);
      
      if (responseCount < 10) {
        return res.json({ 
          percentiles: null,
          message: 'Insufficient data for benchmarks',
          responseCount 
        });
      }
      
      // Compute percentiles from IHS scores
      const result = await client.query(`
        SELECT 
          percentile_cont(ARRAY[0.1, 0.25, 0.5, 0.75, 0.9]) 
            WITHIN GROUP (ORDER BY ihs_score) AS percentiles
        FROM scan_responses 
        WHERE ihs_score IS NOT NULL
      `);
      
      const percentiles = result.rows[0].percentiles;
      
      res.json({ 
        percentiles: percentiles ? percentiles.map(p => Math.round(parseFloat(p) * 10) / 10) : null,
        responseCount,
        labels: ['10th', '25th', '50th', '75th', '90th']
      });
      
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error('Error fetching benchmarks:', err);
    res.status(500).json({ error: 'Failed to fetch benchmarks' });
  }
});

// Get basic statistics
app.get('/api/stats', async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) as total_responses,
          AVG(ihs_score) as avg_ihs,
          MIN(ihs_score) as min_ihs,
          MAX(ihs_score) as max_ihs,
          AVG(completion_time) as avg_completion_time
        FROM scan_responses
        WHERE ihs_score IS NOT NULL
      `);
      
      const stats = result.rows[0];
      
      res.json({
        totalResponses: parseInt(stats.total_responses),
        averageIHS: stats.avg_ihs ? Math.round(parseFloat(stats.avg_ihs) * 10) / 10 : null,
        minIHS: stats.min_ihs ? Math.round(parseFloat(stats.min_ihs) * 10) / 10 : null,
        maxIHS: stats.max_ihs ? Math.round(parseFloat(stats.max_ihs) * 10) / 10 : null,
        averageCompletionTime: stats.avg_completion_time ? Math.round(parseFloat(stats.avg_completion_time)) : null
      });
      
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Benchmarking endpoint - Calculate user's percentile ranking
app.post('/api/benchmarks', async (req, res) => {
  console.log('📊 Benchmark request received:', JSON.stringify(req.body, null, 2));
  
  const { ihsScore, domainScores } = req.body;
  
  if (!ihsScore || !domainScores) {
    return res.status(400).json({ error: 'IHS score and domain scores are required' });
  }
  
  try {
    const client = await pool.connect();
    
    try {
      // Calculate overall IHS percentile
      const ihsPercentileQuery = `
        SELECT 
          COUNT(*) as total_responses,
          COUNT(CASE WHEN ihs_score < $1 THEN 1 END) as lower_scores
        FROM scan_responses 
        WHERE ihs_score IS NOT NULL
      `;
      
      const ihsResult = await client.query(ihsPercentileQuery, [ihsScore]);
      const totalResponses = parseInt(ihsResult.rows[0].total_responses);
      const lowerScores = parseInt(ihsResult.rows[0].lower_scores);
      
      let ihsPercentile = 0;
      if (totalResponses > 0) {
        ihsPercentile = Math.round((lowerScores / totalResponses) * 100);
      }
      
      // Domain percentiles removed - not used by frontend and always showing 0
      
      // Get some additional context stats
      const contextQuery = `
        SELECT 
          AVG(ihs_score) as avg_ihs,
          STDDEV(ihs_score) as stddev_ihs,
          MIN(ihs_score) as min_ihs,
          MAX(ihs_score) as max_ihs
        FROM scan_responses 
        WHERE ihs_score IS NOT NULL
      `;
      
      const contextResult = await client.query(contextQuery);
      const stats = contextResult.rows[0];
      
      // Generate contextual messages
      const generateMessage = (percentile, score, avgScore) => {
        if (percentile >= 90) {
          return `Outstanding! You're in the top ${100 - percentile}% - that's exceptional happiness levels! 🌟`;
        } else if (percentile >= 75) {
          return `Great news! You're happier than ${percentile}% of people who took this scan 😊`;
        } else if (percentile >= 50) {
          return `You're doing well - happier than ${percentile}% of people, with room to grow 🌱`;
        } else if (percentile >= 25) {
          return `Your happiness is ${percentile}th percentile - there's opportunity to flourish 💪`;
        } else {
          return `You're at the ${percentile}th percentile - every small step towards happiness counts 🌈`;
        }
      };
      
      const response = {
        benchmark: {
          totalResponses,
          ihsScore,
          ihsPercentile,
          message: generateMessage(ihsPercentile, ihsScore, parseFloat(stats.avg_ihs)),
          context: {
            averageScore: stats.avg_ihs ? Math.round(parseFloat(stats.avg_ihs) * 10) / 10 : null,
            minScore: stats.min_ihs ? Math.round(parseFloat(stats.min_ihs) * 10) / 10 : null,
            maxScore: stats.max_ihs ? Math.round(parseFloat(stats.max_ihs) * 10) / 10 : null,
            standardDeviation: stats.stddev_ihs ? Math.round(parseFloat(stats.stddev_ihs) * 10) / 10 : null
          }
        }
      };
      
      console.log('📈 Benchmark calculated:', JSON.stringify(response, null, 2));
      res.json(response);
      
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error('Error calculating benchmark:', err);
    res.status(500).json({ error: 'Failed to calculate benchmark' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;

// On Vercel, export the Express app as a serverless function handler.
// Locally, start the HTTP server.
if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 23plusone Happiness Scan server running on port ${PORT}`);
    console.log(`📊 Visit http://localhost:${PORT} to test the scan`);
    console.log(`🔗 Embed URL: http://localhost:${PORT}/scan.html`);
  });
}

module.exports = app;

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  pool.end(() => {
    process.exit(0);
  });
});