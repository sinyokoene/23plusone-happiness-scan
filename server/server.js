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

// Detect demographics table/columns once per process
let detectedDemographics = null; // { table, pidCol, sexCol, ageCol, countryCol }
function qIdent(name){ return '"' + String(name).replace(/"/g, '""') + '"'; }
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
    const pidCol = pick(['prolific_pid','prolific id','prolific_id','participant id','participant_id','prolificid']);
    if (!pidCol) return null;
    return {
      table,
      pidCol,
      sexCol: pick(['sex','gender']) || null,
      ageCol: pick(['age','age years','age_years']) || null,
      countryCol: pick(['country of residence','country_of_residence','country','residence country','residence_country']) || null
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
        const inc = String(countries).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
        if (inc.length) {
          const placeholders = inc.map((_,i)=>`LOWER($${params.length + i + 1})`).join(',');
          params.push(...inc);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) IN (${placeholders})`);
        }
      }
      if (demo && excludeCountries) {
        const ex = String(excludeCountries).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
        if (ex.length) {
          const loweredPlaceholders = ex.map((_,i)=>`LOWER($${params.length + i + 1})`).join(',');
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
// Simple in-memory cache for validity analytics
const __validityCache = new Map(); // key -> { at, ttlMs, data }

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
  function rankArray(arr) {
    const ord = arr.map((v, i) => ({ v: Number(v), i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    for (let k = 0; k < ord.length;) {
      let j = k; while (j < ord.length && ord[j].v === ord[k].v) j++;
      const avg = (k + j - 1) / 2 + 1; // average rank (1-based)
      for (let t = k; t < j; t++) ranks[ord[t].i] = avg;
      k = j;
    }
    return ranks;
  }
  function spearman(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return { r: 0, n };
    const xr = rankArray(x.slice(0, n));
    const yr = rankArray(y.slice(0, n));
    return pearson(xr, yr);
  }

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const device = String(req.query.device || '').toLowerCase(); // 'mobile' | 'desktop' | ''
    const method = String(req.query.method || 'pearson').toLowerCase(); // 'pearson' | 'spearman'
    const modality = String(req.query.modality || '').toLowerCase(); // 'click' | 'swipe' | 'arrow' | ''
    const exclusive = String(req.query.exclusive || '').toLowerCase() === 'true';
    const excludeTimeouts = String(req.query.excludeTimeouts || '').toLowerCase() === 'true';
    const iat = String(req.query.iat || '').toLowerCase() === 'true';
    const sensitivityAllMax = String(req.query.sensitivityAllMax || '').toLowerCase() === 'true';
    const threshold = Number.isFinite(Number(req.query.threshold)) ? Number(req.query.threshold) : null; // 0..100
    // Demographics filters
    const sex = req.query.sex ? String(req.query.sex) : '';
    const country = req.query.country ? String(req.query.country) : '';
    const countries = req.query.countries ? String(req.query.countries) : '';
    const ageMin = Number.isFinite(Number(req.query.ageMin)) ? Number(req.query.ageMin) : null;
    const ageMax = Number.isFinite(Number(req.query.ageMax)) ? Number(req.query.ageMax) : null;
    const excludeCountries = req.query.excludeCountries ? String(req.query.excludeCountries) : '';
    const researchClient = await researchPool.connect();
    const mainClient = await pool.connect();
    try {
      // Ensure table exists (for local dev safety)
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
      } catch (e) {
        console.warn('validity: CREATE TABLE research_entries failed (continuing)', e?.message || e);
      }
      // Ensure optional Prolific columns exist for demographics join
      try { await researchClient.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS prolific_pid TEXT'); } catch(e){ console.warn('validity: add prolific_pid failed', e?.message || e); }
      try { await researchClient.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS prolific_study_id TEXT'); } catch(e){ console.warn('validity: add prolific_study_id failed', e?.message || e); }
      try { await researchClient.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS prolific_session_id TEXT'); } catch(e){ console.warn('validity: add prolific_session_id failed', e?.message || e); }

      // Pull latest research rows with optional demographics filtering
      let demo = null;
      try { demo = await detectDemographics(researchClient); } catch (e) { console.warn('validity: detectDemographics failed', e?.message || e); demo = null; }
      const demoJoin = demo ? ` LEFT JOIN ${qIdent(demo.table)} d ON d.${qIdent(demo.pidCol)} = re.prolific_pid` : '';
      const clauses = [];
      const params = [];
      if (demo && sex) { params.push(sex); clauses.push(`LOWER(d.${qIdent(demo.sexCol || 'sex')}) = LOWER($${params.length})`); }
      if (demo && country) { params.push(country); clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) = LOWER($${params.length})`); }
      if (demo && countries) {
        const inc = countries.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
        if (inc.length) {
          const placeholders = inc.map((_,i)=>`LOWER($${params.length + i + 1})`).join(',');
          params.push(...inc);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) IN (${placeholders})`);
        }
      }
      if (demo && ageMin != null) { params.push(ageMin); clauses.push(`d.${qIdent(demo.ageCol || 'age')} >= $${params.length}`); }
      if (demo && ageMax != null) { params.push(ageMax); clauses.push(`d.${qIdent(demo.ageCol || 'age')} <= $${params.length}`); }
      if (demo && excludeCountries) {
        const ex = excludeCountries.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
        if (ex.length) {
          const loweredPlaceholders = ex.map((_,i)=>`LOWER($${params.length + i + 1})`).join(',');
          params.push(...ex);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) NOT IN (${loweredPlaceholders})`);
        }
      }
      params.push(limit);
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      let researchRows = [];
      try {
        const qres = await researchClient.query(
          `SELECT re.session_id, re.who5, re.swls, re.cantril, re.created_at
           FROM research_entries re${demoJoin}
           ${whereSql}
           ORDER BY re.created_at DESC
           LIMIT $${params.length}`,
          params
        );
        researchRows = qres.rows || [];
      } catch (e) {
        console.warn('validity: SELECT from research_entries failed (continuing with empty set)', e?.message || e);
        researchRows = [];
      }
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
      // Preserve a base set after device filtering but before modality/timeouts/IAT/sensitivity/threshold filters
      const joinedBase = joined.slice();
      if (modality || exclusive || excludeTimeouts || iat || sensitivityAllMax || (threshold != null)) {
        const matchers = {
          click: (m) => m === 'click',
          swipe: (m) => m === 'swipe-touch' || m === 'swipe-mouse',
          arrow: (m) => m === 'keyboard-arrow'
        };
        joined = joined.filter(j => {
          const all = j.selections?.allResponses;
          if (!Array.isArray(all)) return false;
          let counts = { click:0, swipe:0, arrow:0, other:0, total:0 };
          // For split-half reliability on IHS we will also need card-level info
          // but we compute it later using available selections per session.
          for (const e of all) {
            const v = String(e?.inputModality || '').toLowerCase();
            if (matchers.click(v)) counts.click++; else if (matchers.swipe(v)) counts.swipe++; else if (matchers.arrow(v)) counts.arrow++; else counts.other++;
            counts.total++;
          }
          if (excludeTimeouts) {
            if (all.some(e => e && e.response === null)) return false;
          }
          if (iat) {
            const total = all.length;
            if (total < 24) return false;
            let invalid = 0;
            for (const e of all) {
              if (!e) { invalid++; continue; }
              if (e.response === null) { invalid++; continue; }
              const t = Number(e.responseTime);
              if (!Number.isFinite(t)) { invalid++; continue; }
              if (!(t > 300 && t < 2000)) invalid++;
            }
            const fracInvalid = total > 0 ? (invalid / total) : 1;
            if (fracInvalid > 0.10) return false;
          }
          if (sensitivityAllMax) {
            // Exclude only when WHO‑5 and SWLS are both max
            const who5Total = Number.isFinite(Number(j?.who5Percent)) ? (Number(j.who5Percent) / 4) : null; // reverse to 0..25
            const swlsScaled = Number(j?.swlsScaled);
            const swlsTotal = Number.isFinite(swlsScaled) ? Math.round(swlsScaled * (3/5)) : null; // approx back to 3..21
            if ((who5Total != null && who5Total >= 25) && (swlsTotal != null && swlsTotal >= 21)) return false;
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
      const corrFn = (xs, ys) => (method === 'spearman' ? spearman(xs, ys) : pearson(xs, ys));
      for (const c of combos) {
        const { xs, ys } = pair(j => j[c.xKey], j => j[c.yKey]);
        const { r, n } = corrFn(xs, ys);
        overall.push({ x: c.xKey, y: c.yKey, r, n, method });
      }

      // Domain-level correlations
      const domainNames = ['Basics', 'Self-development', 'Ambition', 'Vitality', 'Attraction'];
      const domains = [];
      for (const domain of domainNames) {
        // Build aligned pairs explicitly
        const affWhoX = [], affWhoY = [];
        const affSwlX = [], affSwlY = [];
        const affCanX = [], affCanY = [];
        const xYes = [], yYesWho = [], yYesSwls = [], yYesCan = [];
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
            yYesWho.push(j.who5Percent);
            yYesSwls.push(j.swlsScaled);
            yYesCan.push(j.cantril);
          }
          // Affirmation correlations: include if outcome present; allow zero for sumAff
          const whoY = Number(j.who5Percent);
          if (!Number.isNaN(whoY)) { affWhoX.push(sumAff); affWhoY.push(whoY); }
          const swlY = Number(j.swlsScaled);
          if (!Number.isNaN(swlY)) { affSwlX.push(sumAff); affSwlY.push(swlY); }
          const canY = (j.cantril == null ? NaN : Number(j.cantril));
          if (!Number.isNaN(canY)) { affCanX.push(sumAff); affCanY.push(canY); }
        }
        const affWho = corrFn(affWhoX, affWhoY);
        const affSwl = corrFn(affSwlX, affSwlY);
        const affCan = corrFn(affCanX, affCanY);
        const yesWho = corrFn(xYes, yYesWho);
        const yesSwl = corrFn(xYes, yYesSwls);
        const yesCan = corrFn(xYes, yYesCan);
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
          n_yesrate_cantril: yesCan.n,
          method
        });
      }

      // Card-level correlations
      const cardStats = new Map(); // cardId -> { label, yes:[], affirm:[], who:[], swls:[], whoAff:[], swlsAff:[] }
      for (const j of joined) {
        const all = j.selections?.allResponses;
        if (!Array.isArray(all)) continue;
        for (const e of all) {
          const cid = Number(e.cardId);
          if (!Number.isFinite(cid)) continue;
          if (!cardStats.has(cid)) cardStats.set(cid, { label: e.label || null, yes: [], affirm: [], who: [], swls: [], whoAff: [], swlsAff: [] });
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
            bucket.whoAff.push(j.who5Percent);
            bucket.swlsAff.push(j.swlsScaled);
          }
        }
      }
      const cards = [];
      for (const [cardId, b] of cardStats.entries()) {
        const rYesWho = corrFn(b.yes, b.who);
        const rYesSwl = corrFn(b.yes, b.swls);
        const rAffWho = corrFn(b.affirm, b.whoAff);
        const rAffSwl = corrFn(b.affirm, b.swlsAff);
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
          n_affirm_swls: rAffSwl.n,
          method
        });
      }

      res.json({ overall, domains, cards, usedSessions: joined.length, method });
    } finally {
      researchClient.release();
      mainClient.release();
    }
  } catch (e) {
    console.error('Error computing correlations:', e);
    res.status(500).json({ error: 'Failed to compute correlations' });
  }
});

// Validity analytics: Build Benchmark (z-mean of WHO-5 raw, SWLS raw, Cantril) and compare to IHS
app.get('/api/analytics/validity', async (req, res) => {
  function sumArray(arr) {
    return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
  }
  function mean(arr) {
    if (!arr || arr.length === 0) return NaN;
    return arr.reduce((a,b)=>a+b,0) / arr.length;
  }
  function sd(arr) {
    if (!arr || arr.length < 2) return NaN;
    const m = mean(arr);
    let v = 0;
    for (let i=0;i<arr.length;i++) { const d = arr[i]-m; v += d*d; }
    return Math.sqrt(v / (arr.length - 1));
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
  function rankArray(arr) {
    const ord = arr.map((v, i) => ({ v: Number(v), i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    for (let k = 0; k < ord.length;) {
      let j = k; while (j < ord.length && ord[j].v === ord[k].v) j++;
      const avg = (k + j - 1) / 2 + 1; // average rank (1-based)
      for (let t = k; t < j; t++) ranks[ord[t].i] = avg;
      k = j;
    }
    return ranks;
  }
  function spearman(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return { r: 0, n };
    const xr = rankArray(x.slice(0, n));
    const yr = rankArray(y.slice(0, n));
    return pearson(xr, yr);
  }
  function fisherCIZ(r, n) {
    if (!Number.isFinite(r) || n < 4) return null;
    const z = 0.5 * Math.log((1+r)/(1-r));
    const se = 1 / Math.sqrt(n - 3);
    const zLo = z - 1.96*se;
    const zHi = z + 1.96*se;
    const rLo = (Math.exp(2*zLo)-1)/(Math.exp(2*zLo)+1);
    const rHi = (Math.exp(2*zHi)-1)/(Math.exp(2*zHi)+1);
    return [rLo, rHi];
  }
  function erf(x){
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
    const t = 1/(1 + p*ax);
    const y = 1 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t*Math.exp(-ax*ax);
    return sign * y;
  }
  function normCdf(x){ return 0.5 * (1 + erf(x / Math.SQRT2)); }
  // Incomplete beta and F CDF utilities for p-values
  function gammaln(z){
    const p = [
      676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI*z)) - gammaln(1 - z);
    z -= 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
    const t = z + p.length - 0.5;
    return 0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function betacf(a, b, x) {
    const MAXIT = 200, EPS = 3e-7, FPMIN = 1e-30;
    let qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d;
    let h = d;
    for (let m = 1, m2 = 2; m <= MAXIT; m++, m2 += 2) {
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      const del = d * c; h *= del;
      if (Math.abs(del - 1.0) < EPS) break;
    }
    return h;
  }
  function betainc(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a*Math.log(x) + b*Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function fCdf(f, d1, d2){
    if (!(f >= 0) || d1 <= 0 || d2 <= 0) return NaN;
    const x = (d1 * f) / (d1 * f + d2);
    return betainc(x, d1/2, d2/2);
  }
  function quantile(arr, q){
    if (!arr || arr.length === 0) return NaN;
    const a = arr.slice().sort((x,y)=>x-y);
    const pos = (a.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (a[base+1] !== undefined) return a[base] + rest * (a[base+1] - a[base]);
    return a[base];
  }
  function variance(arr){
    if (!arr || arr.length < 2) return NaN;
    const m = mean(arr);
    let s2 = 0; for (let i=0;i<arr.length;i++){ const d=arr[i]-m; s2 += d*d; }
    return s2 / (arr.length - 1);
  }
  function skewness(arr){
    if (!arr || arr.length < 3) return NaN;
    const n = arr.length; const m = mean(arr); let m2=0, m3=0;
    for (let i=0;i<n;i++){ const d=arr[i]-m; m2 += d*d; m3 += d*d*d; }
    m2 /= n; m3 /= n; const s = Math.sqrt(m2);
    return (s === 0) ? 0 : (m3 / (s*s*s));
  }
  function kurtosisExcess(arr){
    if (!arr || arr.length < 4) return NaN;
    const n = arr.length; const m = mean(arr); let m2=0, m4=0;
    for (let i=0;i<n;i++){ const d=arr[i]-m; const d2=d*d; m2 += d2; m4 += d2*d2; }
    m2 /= n; m4 /= n; if (!m2) return 0; return (m4/(m2*m2)) - 3;
  }
  function bootstrap(values, statFn, B){
    const n = values.length; if (n === 0) return { stats: [] };
    const out = []; const idx = new Array(n);
    for (let b=0;b<B;b++){
      for (let i=0;i<n;i++){ idx[i] = Math.floor(Math.random()*n); }
      const sample = idx.map(i=>values[i]);
      out.push(statFn(sample));
    }
    return { stats: out };
  }
  function powerIterSym3(M, iters=100){
    // M is 3x3 symmetric
    let v = [1,0,0];
    for (let t=0;t<iters;t++){
      const w = [
        M[0][0]*v[0] + M[0][1]*v[1] + M[0][2]*v[2],
        M[1][0]*v[0] + M[1][1]*v[1] + M[1][2]*v[2],
        M[2][0]*v[0] + M[2][1]*v[1] + M[2][2]*v[2]
      ];
      const norm = Math.sqrt(w[0]*w[0] + w[1]*w[1] + w[2]*w[2]) || 1;
      v = [w[0]/norm, w[1]/norm, w[2]/norm];
    }
    const ev = (
      v[0]*(M[0][0]*v[0] + M[0][1]*v[1] + M[0][2]*v[2]) +
      v[1]*(M[1][0]*v[0] + M[1][1]*v[1] + M[1][2]*v[2]) +
      v[2]*(M[2][0]*v[0] + M[2][1]*v[1] + M[2][2]*v[2])
    );
    return { vec: v, val: ev };
  }
  function aucFromScores(scores, labels){
    const pairs = scores.map((s,i)=>({ s, y: labels[i] }));
    const valid = pairs.filter(p=>Number.isFinite(p.s) && (p.y===0 || p.y===1));
    const n1 = valid.filter(p=>p.y===1).length; const n0 = valid.length - n1;
    if (n1===0 || n0===0) return { auc: null, n: valid.length };
    // Mann-Whitney U via ranks
    const ord = valid.map((p,i)=>({ ...p, i })).sort((a,b)=> a.s - b.s);
    let rank = 1; const ranks = new Array(ord.length);
    for (let k=0;k<ord.length;){
      let j=k; while (j<ord.length && ord[j].s===ord[k].s) j++;
      const avg = (k + j - 1)/2 + 1;
      for (let t=k;t<j;t++) ranks[ord[t].i] = avg;
      k=j;
    }
    let rankSumPos = 0; for (let i=0;i<valid.length;i++){ if (valid[i].y===1) rankSumPos += ranks[i]; }
    const U = rankSumPos - n1*(n1+1)/2;
    const auc = U / (n0*n1);
    return { auc, n: valid.length };
  }

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const device = String(req.query.device || '').toLowerCase(); // 'mobile' | 'desktop' | ''
    const method = String(req.query.method || 'pearson').toLowerCase(); // 'pearson' | 'spearman'
    const modality = String(req.query.modality || '').toLowerCase(); // 'click' | 'swipe' | 'arrow' | ''
    const exclusive = String(req.query.exclusive || '').toLowerCase() === 'true';
    const excludeTimeouts = String(req.query.excludeTimeouts || '').toLowerCase() === 'true';
    const iat = String(req.query.iat || '').toLowerCase() === 'true';
    const sensitivityAllMax = String(req.query.sensitivityAllMax || '').toLowerCase() === 'true';
    const threshold = Number.isFinite(Number(req.query.threshold)) ? Number(req.query.threshold) : null; // 0..100
    const includePerSession = String(req.query.includePerSession || '').toLowerCase() === 'true';
    // Demographics filters
    const sex = req.query.sex ? String(req.query.sex) : '';
    const country = req.query.country ? String(req.query.country) : '';
    const countries = req.query.countries ? String(req.query.countries) : '';
    const ageMin = Number.isFinite(Number(req.query.ageMin)) ? Number(req.query.ageMin) : null;
    const ageMax = Number.isFinite(Number(req.query.ageMax)) ? Number(req.query.ageMax) : null;
    const excludeCountries = req.query.excludeCountries ? String(req.query.excludeCountries) : '';

    // cache key includes all relevant params
    const cacheKey = JSON.stringify({
      limit, device, method, modality, exclusive, excludeTimeouts, iat, sensitivityAllMax, threshold,
      includePerSession, sex, country, countries, ageMin, ageMax, excludeCountries
    });
    const cached = __validityCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < (cached.ttlMs || 60000)) {
      return res.json({ ...cached.data, cache: { hit: true } });
    }

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

      const demo = await detectDemographics(researchClient);
      const demoJoin = demo ? ` LEFT JOIN ${qIdent(demo.table)} d ON d.${qIdent(demo.pidCol)} = re.prolific_pid` : '';
      const clauses = [];
      const params = [];
      if (demo && sex) { params.push(sex); clauses.push(`LOWER(d.${qIdent(demo.sexCol || 'sex')}) = LOWER($${params.length})`); }
      if (demo && country) { params.push(country); clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) = LOWER($${params.length})`); }
      if (demo && countries) {
        const inc = countries.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
        if (inc.length) {
          const placeholders = inc.map((_,i)=>`LOWER($${params.length + i + 1})`).join(',');
          params.push(...inc);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) IN (${placeholders})`);
        }
      }
      if (demo && ageMin != null) { params.push(ageMin); clauses.push(`d.${qIdent(demo.ageCol || 'age')} >= $${params.length}`); }
      if (demo && ageMax != null) { params.push(ageMax); clauses.push(`d.${qIdent(demo.ageCol || 'age')} <= $${params.length}`); }
      if (demo && excludeCountries) {
        const ex = excludeCountries.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
        if (ex.length) {
          const loweredPlaceholders = ex.map((_,i)=>`LOWER($${params.length + i + 1})`).join(',');
          params.push(...ex);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) NOT IN (${loweredPlaceholders})`);
        }
      }
      params.push(limit);
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows: researchRows } = await researchClient.query(
        `SELECT re.session_id, re.who5, re.swls, re.cantril, re.created_at
         FROM research_entries re${demoJoin}
         ${whereSql}
         ORDER BY re.created_at DESC
         LIMIT $${params.length}`,
        params
      );
      const rBySession = new Map();
      for (const r of researchRows) {
        const who5Total = sumArray(r.who5); // 0-25
        const swlsTotal = sumArray(r.swls); // 3-21
        rBySession.set(r.session_id, {
          who5Total,
          swlsTotal,
          cantril: (r.cantril == null ? null : Number(r.cantril))
        });
      }

      const sessionIds = Array.from(rBySession.keys());
      if (!sessionIds.length) {
        return res.json({ n_used: 0, method, correlation: { r: null, n: 0, ci95: null }, benchmark: { method: 'z_mean' } });
      }

      const { rows: scanRows } = await mainClient.query(
        `SELECT session_id, ihs_score, n1_score, n2_score, n3_score, card_selections, user_agent
         FROM scan_responses
         WHERE session_id = ANY($1::text[])`, [sessionIds]
      );

      // Build joined set
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
          who5Total: r.who5Total,
          swlsTotal: r.swlsTotal,
          cantril: r.cantril,
          selections: s.card_selections,
          scan_user_agent: s.user_agent || null
        });
      }

      function isMobileUA(ua) {
        if (!ua || typeof ua !== 'string') return false;
        return /(Mobi|Android|iPhone|iPad|iPod)/i.test(ua);
      }
      if (device === 'mobile') {
        joined = joined.filter(j => isMobileUA(j.scan_user_agent));
      } else if (device === 'desktop') {
        joined = joined.filter(j => !isMobileUA(j.scan_user_agent));
      }
      if (modality || exclusive || excludeTimeouts || iat || sensitivityAllMax || (threshold != null)) {
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
          if (iat) {
            const total = all.length;
            if (total < 24) return false;
            let invalid = 0;
            for (const e of all) {
              if (!e) { invalid++; continue; }
              if (e.response === null) { invalid++; continue; }
              const t = Number(e.responseTime);
              if (!Number.isFinite(t)) { invalid++; continue; }
              if (!(t > 300 && t < 2000)) invalid++;
            }
            const fracInvalid = total > 0 ? (invalid / total) : 1;
            if (fracInvalid > 0.10) return false;
          }
          if (sensitivityAllMax) {
            const who5Total = Number(j?.who5Total);
            const swlsTotal = Number(j?.swlsTotal);
            if ((Number.isFinite(who5Total) && who5Total >= 25) && (Number.isFinite(swlsTotal) && swlsTotal >= 21)) return false;
          }
          if (modality) {
            if (modality === 'click' && counts.click === 0) return false;
            if (modality === 'swipe' && counts.swipe === 0) return false;
            if (modality === 'arrow' && counts.arrow === 0) return false;
          }
          if (exclusive) {
            const present = [counts.click>0, counts.swipe>0, counts.arrow>0].filter(Boolean).length;
            if (present !== 1) return false;
          }
          if (threshold != null && counts.total > 0 && modality) {
            const frac = (modality === 'click' ? counts.click : modality === 'swipe' ? counts.swipe : counts.arrow) / counts.total;
            if ((frac * 100) < threshold) return false;
          }
          return true;
        });
      }

      // Compute component means/sds (on available non-null values)
      const whoVals = joined.map(j=>j.who5Total).filter(v=>v!=null && Number.isFinite(Number(v)));
      const swlVals = joined.map(j=>j.swlsTotal).filter(v=>v!=null && Number.isFinite(Number(v)));
      const canVals = joined.map(j=>j.cantril).filter(v=>v!=null && Number.isFinite(Number(v)));
      const whoMean = mean(whoVals), whoSd = sd(whoVals);
      const swlMean = mean(swlVals), swlSd = sd(swlVals);
      const canMean = mean(canVals), canSd = sd(canVals);

      // Per-session z-mean composite (require at least 2 present)
      const pairsIhs = [], pairsBench = [];
      const perSession = [];
      const benchVals = [];
      for (const j of joined) {
        const zs = [];
        if (j.who5Total != null && Number.isFinite(j.who5Total) && Number.isFinite(whoSd) && whoSd > 0) zs.push((j.who5Total - whoMean)/whoSd);
        if (j.swlsTotal != null && Number.isFinite(j.swlsTotal) && Number.isFinite(swlSd) && swlSd > 0) zs.push((j.swlsTotal - swlMean)/swlSd);
        if (j.cantril != null && Number.isFinite(j.cantril) && Number.isFinite(canSd) && canSd > 0) zs.push((j.cantril - canMean)/canSd);
        if (zs.length >= 2 && j.ihs != null && Number.isFinite(j.ihs)) {
          const zMean = zs.reduce((a,b)=>a+b,0) / zs.length;
          pairsIhs.push(Number(j.ihs));
          pairsBench.push(zMean);
          benchVals.push({ sessionId: j.sessionId, z: zMean, who5: j.who5Total, swls: j.swlsTotal, cantril: j.cantril });
          if (includePerSession) perSession.push({ sessionId: j.sessionId, ihs: Number(j.ihs), who5: j.who5Total, swls: j.swlsTotal, cantril: j.cantril, z_benchmark: zMean });
        }
      }

      const n = Math.min(pairsIhs.length, pairsBench.length);
      let r = null, ci95 = null;
      if (n >= 2) {
        const out = (method === 'spearman') ? spearman(pairsIhs, pairsBench) : pearson(pairsIhs, pairsBench);
        r = out.r;
        if (method === 'pearson') ci95 = fisherCIZ(r, out.n);
      }

      // Reliability: IHS split-half (deterministic alternating by card order) + Spearman–Brown
      let ihsReliability = null;
      try {
        const halves = [];
        for (const j of joined) {
          const all = j.selections?.allResponses;
          if (!Array.isArray(all) || all.length < 10) continue;
          let sA = 0, cA = 0, sB = 0, cB = 0;
          for (let idx=0; idx<all.length; idx++) {
            const e = all[idx];
            if (!e || e.response == null) continue;
            const isYes = e.response === true;
            const t = Number(e.responseTime);
            const timeMultiplier = (ms) => { const x=Math.max(0, Math.min(4000, Number(ms)||0)); const lin=(4000-x)/4000; return Math.sqrt(Math.max(0, lin)); };
            const val = isYes ? (4 * timeMultiplier(t)) : 0;
            if (idx % 2 === 0) { sA += val; cA++; } else { sB += val; cB++; }
          }
          if (cA > 0 && cB > 0) {
            halves.push({ a: sA, b: sB });
          }
        }
        if (halves.length >= 10) {
          const xs = halves.map(h=>h.a);
          const ys = halves.map(h=>h.b);
          const rHalf = pearson(xs, ys).r;
          const sb = (2 * rHalf) / (1 + rHalf);
          // bootstrap CI over SB
          const B = Math.min(500, Math.max(100, Math.floor(halves.length * 10)));
          const { stats } = bootstrap(halves, (sample)=>{
            const sx = sample.map(h=>h.a); const sy = sample.map(h=>h.b);
            const rr = pearson(sx, sy).r;
            return (2*rr)/(1+rr);
          }, B);
          const lo = quantile(stats, 0.025), hi = quantile(stats, 0.975);
          ihsReliability = { sb: sb, ci95: [lo, hi], n: halves.length };
        }
      } catch (_) { ihsReliability = null; }

      // Benchmark reliability (omega) via one-factor PCA approx on standardized components
      let benchmarkOmega = null;
      try {
        const rows = benchVals.filter(b => Number.isFinite(b.who5) && Number.isFinite(b.swls) && Number.isFinite(b.cantril));
        const Z = rows.map(b => [
          (Number.isFinite(whoSd) && whoSd>0) ? (b.who5-whoMean)/whoSd : 0,
          (Number.isFinite(swlSd) && swlSd>0) ? (b.swls-swlMean)/swlSd : 0,
          (Number.isFinite(canSd) && canSd>0) ? (b.cantril-canMean)/canSd : 0
        ]);
        if (Z.length >= 20) {
          const p = 3; const S = new Array(p).fill(0).map(()=>new Array(p).fill(0));
          for (let i=0;i<Z.length;i++){
            for (let a=0;a<p;a++) for (let b=0;b<p;b++) S[a][b] += Z[i][a]*Z[i][b];
          }
          for (let a=0;a<p;a++) for (let b=0;b<p;b++) S[a][b] /= (Z.length - 1);
          const { vec, val } = powerIterSym3(S, 200);
          const loadings = vec.map(v => v * Math.sqrt(Math.max(0, val)));
          const sumLoad2 = loadings.reduce((s,l)=>s + l*l, 0);
          const uniq = loadings.map(l => Math.max(0, 1 - l*l));
          const sumUniq = uniq.reduce((s,u)=>s+u,0);
          const omega = sumLoad2 / (sumLoad2 + sumUniq);
          // bootstrap omega
          const B = Math.min(500, Math.max(200, Math.floor(Z.length * 2)));
          const { stats } = bootstrap(Z, (sample)=>{
            const n = sample.length; const S2 = new Array(p).fill(0).map(()=>new Array(p).fill(0));
            for (let i=0;i<n;i++){
              for (let a=0;a<p;a++) for (let b=0;b<p;b++) S2[a][b] += sample[i][a]*sample[i][b];
            }
            for (let a=0;a<p;a++) for (let b=0;b<p;b++) S2[a][b] /= (n - 1);
            const r = powerIterSym3(S2, 100);
            const loads = r.vec.map(v => v * Math.sqrt(Math.max(0, r.val)));
            const sl2 = loads.reduce((s,l)=>s + l*l, 0);
            const uq = loads.map(l => Math.max(0, 1 - l*l));
            const su = uq.reduce((s,u)=>s+u,0);
            return sl2 / (sl2 + su);
          }, B);
          const lo = quantile(stats, 0.025), hi = quantile(stats, 0.975);
          benchmarkOmega = { omega, ci95: [lo, hi], n: Z.length };
        }
      } catch (_) { benchmarkOmega = null; }

      // Attenuation correction
      let attenuation = null;
      try {
        if (Number.isFinite(r)) {
          const relIhs = ihsReliability && Number.isFinite(ihsReliability.sb) ? ihsReliability.sb : null;
          const relBench = benchmarkOmega && Number.isFinite(benchmarkOmega.omega) ? benchmarkOmega.omega : null;
          if (relIhs != null && relBench != null && relIhs > 0 && relBench > 0) {
            const rTrue = r / Math.sqrt(relIhs * relBench);
            attenuation = { r_obs: r, r_true: Math.max(-1, Math.min(1, rTrue)) };
          }
        }
      } catch (_) { attenuation = null; }

      // Ceiling/compression metrics
      const ceiling = {};
      try {
        const who = whoVals.slice();
        const swl = swlVals.slice();
        const can = canVals.slice();
        const ihsAllVals = joined.map(j=>Number(j.ihs)).filter(v=>Number.isFinite(v));
        const pctMax = (vals, maxv) => vals.length ? (100 * vals.filter(v=>v>=maxv).length / vals.length) : null;
        const topBox = (vals, frac=0.10) => vals.length ? (100 * vals.filter(v=>v >= quantile(vals, 1-frac)).length / vals.length) : null;
        ceiling.who5 = { pct_max: pctMax(who, 25), top10: topBox(who), skew: skewness(who), kurtosis: kurtosisExcess(who) };
        ceiling.swls = { pct_max: pctMax(swl, 21), top10: topBox(swl), skew: skewness(swl), kurtosis: kurtosisExcess(swl) };
        ceiling.cantril = { pct_max: pctMax(can, 10), top10: topBox(can), skew: skewness(can), kurtosis: kurtosisExcess(can) };
        ceiling.ihs = { pct_max: pctMax(ihsAllVals, 100), top10: topBox(ihsAllVals), skew: skewness(ihsAllVals), kurtosis: kurtosisExcess(ihsAllVals) };
      } catch (_) {}

      // ROC/AUC: define positive as top 25% of Benchmark
      let roc = null;
      try {
        if (pairsBench.length >= 10) {
          const scores = pairsIhs.slice();
          const thr = quantile(pairsBench.slice(), 0.75);
          const labels = pairsBench.map(b => (b >= thr ? 1 : 0));
          const base = aucFromScores(scores, labels);
          // bootstrap CI for AUC
          const nObs = scores.length; const idx = new Array(nObs);
          const B = Math.min(500, Math.max(200, Math.floor(nObs * 2)));
          const aucs = [];
          for (let b=0;b<B;b++){
            for (let i=0;i<nObs;i++){ idx[i] = Math.floor(Math.random()*nObs); }
            const s = idx.map(i=>scores[i]); const y = idx.map(i=>labels[i]);
            const a = aucFromScores(s, y).auc; if (a!=null) aucs.push(a);
          }
          const lo = quantile(aucs, 0.025), hi = quantile(aucs, 0.975);
          // ROC curve points (downsampled)
          const pairs = scores.map((s,i)=>({ s, y: labels[i] }));
          const ord = pairs.slice().sort((a,b)=> b.s - a.s);
          const uniqScores = Array.from(new Set(ord.map(p=>p.s)));
          const targetPts = 60;
          const stride = Math.max(1, Math.ceil(uniqScores.length / targetPts));
          const thresholds = uniqScores.filter((_,i)=> i % stride === 0);
          const nPos = labels.filter(v=>v===1).length; const nNeg = labels.length - nPos;
          const pts = [];
          for (const t of thresholds) {
            let tp=0, fp=0, tn=0, fn=0;
            for (let i=0;i<ord.length;i++){
              const pred = ord[i].s >= t ? 1 : 0;
              const y = ord[i].y;
              if (pred===1 && y===1) tp++; else if (pred===1 && y===0) fp++; else if (pred===0 && y===0) tn++; else fn++;
            }
            const tpr = nPos ? tp/nPos : 0;
            const fpr = nNeg ? fp/nNeg : 0;
            pts.push({ fpr, tpr, thr: t });
          }
          roc = { auc: base.auc, ci95: [lo, hi], n: base.n, threshold: thr, points: pts };
        }
      } catch (_) { roc = null; }

      // Robustness: compute Base vs Filtered summaries (r and AUC) using same method
      function summarize(joinedLocal) {
        // components
        const who = joinedLocal.map(j=>j.who5Total).filter(v=>v!=null && Number.isFinite(Number(v)));
        const swl = joinedLocal.map(j=>j.swlsTotal).filter(v=>v!=null && Number.isFinite(Number(v)));
        const can = joinedLocal.map(j=>j.cantril).filter(v=>v!=null && Number.isFinite(Number(v)));
        const wM = mean(who), wS = sd(who);
        const sM = mean(swl), sS = sd(swl);
        const cM = mean(can), cS = sd(can);
        const ihsArr = [], bmkArr = [];
        for (const j of joinedLocal) {
          const zs = [];
          if (j.who5Total!=null && Number.isFinite(j.who5Total) && Number.isFinite(wS) && wS>0) zs.push((j.who5Total - wM)/wS);
          if (j.swlsTotal!=null && Number.isFinite(j.swlsTotal) && Number.isFinite(sS) && sS>0) zs.push((j.swlsTotal - sM)/sS);
          if (j.cantril!=null && Number.isFinite(j.cantril) && Number.isFinite(cS) && cS>0) zs.push((j.cantril - cM)/cS);
          if (zs.length>=2 && j.ihs!=null && Number.isFinite(j.ihs)) { ihsArr.push(Number(j.ihs)); bmkArr.push(zs.reduce((a,b)=>a+b,0)/zs.length); }
        }
        const nloc = Math.min(ihsArr.length, bmkArr.length);
        let rloc = null; if (nloc>=2) { const out = (method==='spearman'? spearman(ihsArr, bmkArr): pearson(ihsArr, bmkArr)); rloc = out.r; }
        let aucloc = null; if (nloc>=10) { const thr = quantile(bmkArr.slice(), 0.75); const labels = bmkArr.map(b => (b>=thr?1:0)); aucloc = aucFromScores(ihsArr, labels).auc; }
        return { n: nloc, r: rloc, auc: aucloc };
      }
      const baseForRobustness = (typeof joinedBase !== 'undefined') ? joinedBase : joined.slice();
      const robustness = { base: summarize(baseForRobustness), filtered: summarize(joined) };

      // Non-inferiority vs best single (Pearson, Fisher z diff approximation)
      let nonInferiority = null;
      let compsVsB = null;
      if (benchVals.length >= 2) {
        const bx = benchVals.map(b=>b.z);
        function corrWith(fn){
          const xs = benchVals.map(b=>fn(b));
          const valid = [];
          for (let i=0;i<xs.length;i++) {
            const x = xs[i]; const y = bx[i];
            if (x!=null && Number.isFinite(x) && y!=null && Number.isFinite(y)) valid.push([x,y]);
          }
          const vx = valid.map(p=>p[0]);
          const vy = valid.map(p=>p[1]);
          if (vx.length < 2) return { r: null, n: vx.length };
          const out = pearson(vx, vy);
          return { r: out.r, n: out.n };
        }
        const rWho = corrWith(b=>b.who5);
        const rSwl = corrWith(b=>b.swls);
        const rCan = corrWith(b=>b.cantril);
        compsVsB = { who5: rWho, swls: rSwl, cantril: rCan };
        // r(IHS,B) using Pearson for this test
        let rIhsPear = null, nIhsPear = n;
        if (n >= 2) { const o = pearson(pairsIhs, pairsBench); rIhsPear = o.r; nIhsPear = o.n; }
        // Choose best single by absolute r
        const cand = [ ['who5', rWho], ['swls', rSwl], ['cantril', rCan] ].filter(([_,v])=>v && v.r!=null);
        if (cand.length) {
          cand.sort((a,b)=> Math.abs((b[1].r||0)) - Math.abs((a[1].r||0)) );
          const best = cand[0];
          const bestName = best[0];
          const rBest = best[1].r;
          const nBest = best[1].n;
          const margin = 0.05;
          let zstat = null, pval = null, pass = null, deltaR = null;
          if (rIhsPear!=null && nIhsPear>=4 && rBest!=null && nBest>=4) {
            const clip = (v)=> Math.max(-0.999999, Math.min(0.999999, Number(v)||0));
            const z1 = 0.5 * Math.log((1+clip(rIhsPear))/(1-clip(rIhsPear)));
            const z2 = 0.5 * Math.log((1+clip(rBest))/(1-clip(rBest)));
            const se = Math.sqrt(1/(nIhsPear-3) + 1/(nBest-3));
            zstat = (z1 - z2) / se;
            pval = 2 * (1 - normCdf(Math.abs(zstat)));
            deltaR = rIhsPear - rBest;
            pass = (rBest - rIhsPear) <= margin;
          }
          nonInferiority = {
            best_single: bestName,
            r_best: rBest,
            n_best: nBest,
            r_ihs: rIhsPear,
            n_ihs: nIhsPear,
            delta_r: deltaR,
            z: zstat,
            p: pval,
            margin,
            pass
          };
        }
      }

      // Incremental validity: Benchmark ~ WHO5 + SWLS + Cantril; Step 2 add IHS
      let regression = null;
      try {
        const ihsBySession = new Map(joined.map(j => [j.sessionId, Number(j.ihs)]));
        const rows = benchVals.filter(b => b && Number.isFinite(b.z) && Number.isFinite(b.who5) && Number.isFinite(b.swls) && Number.isFinite(b.cantril));
        // standardize predictors for stability and beta reporting
        const zOf = {
          who5: (v) => (Number.isFinite(whoSd) && whoSd > 0 ? (v - whoMean)/whoSd : 0),
          swls: (v) => (Number.isFinite(swlSd) && swlSd > 0 ? (v - swlMean)/swlSd : 0),
          cantril: (v) => (Number.isFinite(canSd) && canSd > 0 ? (v - canMean)/canSd : 0)
        };
        const y = [];
        const X1 = []; // [whoZ, swlsZ, canZ]
        const X2 = []; // [whoZ, swlsZ, canZ, ihsZ]
        let ihsMean = null, ihsSd = null;
        // collect ihs for z
        const ihsValsForZ = [];
        for (const b of rows) {
          const ihs = ihsBySession.get(b.sessionId);
          if (ihs == null || !Number.isFinite(ihs)) continue;
          ihsValsForZ.push(ihs);
        }
        if (ihsValsForZ.length >= 2) {
          ihsMean = mean(ihsValsForZ);
          ihsSd = sd(ihsValsForZ);
        }
        for (const b of rows) {
          const ihs = ihsBySession.get(b.sessionId);
          if (ihs == null || !Number.isFinite(ihs)) continue;
          const whoZ = zOf.who5(b.who5);
          const swlZ = zOf.swls(b.swls);
          const canZ = zOf.cantril(b.cantril);
          const ihsZ = (Number.isFinite(ihsSd) && ihsSd > 0) ? ((ihs - ihsMean) / ihsSd) : 0;
          X1.push([whoZ, swlZ, canZ]);
          X2.push([whoZ, swlZ, canZ, ihsZ]);
          y.push(Number(b.z));
        }
        const nReg = y.length;
        function xtx(X){
          const p = X[0].length + 1; // + intercept
          const m = new Array(p).fill(0).map(()=>new Array(p).fill(0));
          for (let i=0;i<X.length;i++) {
            const row = [1, ...X[i]];
            for (let a=0;a<p;a++) for (let b=0;b<p;b++) m[a][b] += row[a]*row[b];
          }
          return m;
        }
        function xty(X, y){
          const p = X[0].length + 1;
          const v = new Array(p).fill(0);
          for (let i=0;i<X.length;i++) {
            const row = [1, ...X[i]];
            for (let a=0;a<p;a++) v[a] += row[a]*y[i];
          }
          return v;
        }
        function matInv(A){
          const n = A.length;
          const M = A.map(r => r.slice());
          const I = new Array(n).fill(0).map((_,i)=>{
            const row = new Array(n).fill(0); row[i]=1; return row;
          });
          for (let i=0;i<n;i++) {
            // pivot
            let maxR = i; let maxV = Math.abs(M[i][i]);
            for (let r=i+1;r<n;r++){ const v=Math.abs(M[r][i]); if (v>maxV){maxV=v; maxR=r;} }
            if (maxR!==i){ const tmp=M[i]; M[i]=M[maxR]; M[maxR]=tmp; const tmp2=I[i]; I[i]=I[maxR]; I[maxR]=tmp2; }
            let piv = M[i][i]; if (Math.abs(piv) < 1e-12) return null;
            for (let j=0;j<n;j++){ M[i][j]/=piv; I[i][j]/=piv; }
            for (let r=0;r<n;r++) if (r!==i){ const f=M[r][i]; for (let j=0;j<n;j++){ M[r][j]-=f*M[i][j]; I[r][j]-=f*I[i][j]; } }
          }
          return I;
        }
        function matVec(M, v){
          return M.map(row => row.reduce((s, a, i)=> s + a*v[i], 0));
        }
        function r2For(X, y){
          if (!X.length) return { r2: 0, beta: null };
          const XT = xtx(X);
          const Xy = xty(X, y);
          const inv = matInv(XT);
          if (!inv) return { r2: 0, beta: null };
          const beta = matVec(inv, Xy);
          let ssTot = 0, ssRes = 0;
          const yMean = mean(y);
          for (let i=0;i<X.length;i++) {
            const xrow = [1, ...X[i]];
            const yhat = xrow.reduce((s,a,idx)=> s + a*beta[idx], 0);
            const err = y[i] - yhat;
            ssRes += err*err; const d = y[i] - yMean; ssTot += d*d;
          }
          const r2 = (ssTot > 0) ? (1 - ssRes/ssTot) : 0;
          return { r2, beta };
        }
        if (nReg >= 8) {
          const base = r2For(X1, y);
          const full = r2For(X2, y);
          const p1 = 3, p2 = 4; // predictors count (without intercept)
          const df1 = p2 - p1;
          const df2 = nReg - p2 - 1;
          let F = null, pF = null, dR2 = null, betaIhs = null;
          if (Number.isFinite(base.r2) && Number.isFinite(full.r2) && df2 > 0) {
            dR2 = Math.max(0, full.r2 - base.r2);
            F = (dR2/df1) / ((1 - full.r2) / df2);
            const cdf = fCdf(F, df1, df2);
            pF = (Number.isFinite(cdf) ? (1 - cdf) : null);
          }
          if (Array.isArray(full.beta) && full.beta.length === 5) {
            betaIhs = full.beta[4]; // intercept, whoZ, swlZ, canZ, ihsZ
          }
          regression = { n: nReg, r2_base: base.r2, r2_full: full.r2, delta_r2: dR2, f: F, df1, df2, p: pF, beta_ihs: betaIhs };
        } else {
          regression = { n: nReg };
        }
      } catch (e) {
        regression = { error: 'regression_failed' };
      }

      // AUC for questionnaires vs top 25% benchmark
      let aucWho = null, aucSwl = null, aucCan = null, aucBestQ = null, aucBestQName = null;
      try {
        if (benchVals.length >= 10) {
          const thrQ = quantile(benchVals.map(b=>b.z).slice(), 0.75);
          const labelsQ = benchVals.map(b => (b.z >= thrQ ? 1 : 0));
          const whoScores = benchVals.map(b=>b.who5);
          const swlScores = benchVals.map(b=>b.swls);
          const canScores = benchVals.map(b=>b.cantril);
          const aWho = aucFromScores(whoScores, labelsQ).auc;
          const aSwl = aucFromScores(swlScores, labelsQ).auc;
          const aCan = aucFromScores(canScores, labelsQ).auc;
          aucWho = aWho; aucSwl = aSwl; aucCan = aCan;
          const cands = [ ['who5', aWho], ['swls', aSwl], ['cantril', aCan] ].filter(([_,v])=>v!=null);
          if (cands.length) { cands.sort((a,b)=> (b[1]||0) - (a[1]||0)); aucBestQName = cands[0][0]; aucBestQ = cands[0][1]; }
        }
      } catch (_) {}

      // Evidence grader
      let grader = null;
      try {
        const thresholds = { m_noninf: 0.05, dR2: 0.02, aucMeaningful: 0.03, aucSimilar: 0.02, ceilAdv: 10, relOk: 0.75, nOk: 200 };
        const rObs = r;
        const rBest = (nonInferiority && nonInferiority.best_single && compsVsB && compsVsB[nonInferiority.best_single]) ? compsVsB[nonInferiority.best_single].r : null;
        const dR2 = regression && typeof regression.delta_r2 === 'number' ? regression.delta_r2 : null;
        const pDR2 = regression && typeof regression.p === 'number' ? regression.p : null;
        const aucIhs = roc && typeof roc.auc === 'number' ? roc.auc : null;
        const aucBest = typeof aucBestQ === 'number' ? aucBestQ : null;
        const aucDiff = (aucIhs!=null && aucBest!=null) ? (aucIhs - aucBest) : null;
        const ceilIhs = ceiling && ceiling.ihs ? ceiling.ihs.pct_max : null;
        const ceilWho = ceiling && ceiling.who5 ? ceiling.who5.pct_max : null;
        const ceilSwl = ceiling && ceiling.swls ? ceiling.swls.pct_max : null;
        const relIhs = ihsReliability && typeof ihsReliability.sb === 'number' ? ihsReliability.sb : null;
        const relBench = benchmarkOmega && typeof benchmarkOmega.omega === 'number' ? benchmarkOmega.omega : null;
        const nEff = n;
        const nonInf = !!(nonInferiority && nonInferiority.pass);
        const deltaGood = (dR2!=null && dR2 >= thresholds.dR2 && pDR2!=null && pDR2 < 0.05);
        const aucMuchBetter = (aucDiff!=null && aucDiff >= thresholds.aucMeaningful);
        const aucSimilar = (aucDiff!=null && Math.abs(aucDiff) <= thresholds.aucSimilar);
        const ceilAdv = (ceilIhs!=null && ceilWho!=null && ceilSwl!=null && (ceilWho - ceilIhs) >= thresholds.ceilAdv && (ceilSwl - ceilIhs) >= thresholds.ceilAdv);
        const relOk = (relIhs!=null && relIhs >= thresholds.relOk) && (relBench!=null && relBench >= thresholds.relOk);
        const nOk = (nEff!=null && nEff >= thresholds.nOk);

        const reasons = [];
        const warnings = [];
        if (nonInf) reasons.push('Non-inferior to best questionnaire (Δr ≤ .05)'); else reasons.push('Fails non-inferiority (Δr > .05)');
        if (deltaGood) reasons.push('Adds meaningful variance (ΔR² ≥ .02, p<.05)');
        if (aucMuchBetter) reasons.push('Higher AUC than best questionnaire (≥ .03)'); else if (aucSimilar) reasons.push('AUC similar to best questionnaire (±.02)');
        if (ceilAdv) reasons.push('Less ceiling (≥10pp fewer max scores)');
        if (relOk) reasons.push('Reliability acceptable (SB/Ω ≥ .75)'); else warnings.push('Reliability below .75');
        if (!nOk) warnings.push('Small n (<200)');

        let label = 'Inconclusive (data quality)';
        let conclusion = 'Insufficient evidence due to data/quality limits.';
        if (nonInf && deltaGood && aucMuchBetter && (ceilAdv || relOk) && nOk) {
          label = 'Clearly better';
          conclusion = 'IHS outperforms questionnaires and adds predictive value.';
        } else if (nonInf && (aucSimilar || aucDiff==null) && (dR2!=null && dR2 >= 0) && nOk) {
          label = 'At least as good';
          conclusion = 'IHS performs on par with the best questionnaire and is non-inferior.';
        } else if ((nonInf || aucSimilar || aucDiff==null) && (!nOk || !relOk) && (dR2==null || dR2 >= 0.01)) {
          label = 'Promising but needs more data';
          conclusion = 'Preliminary signals are positive; increase n and ensure reliability.';
        } else if ((!nonInf) || (aucDiff!=null && aucDiff <= -thresholds.aucMeaningful)) {
          label = 'Not yet competitive';
          conclusion = 'IHS trails the best questionnaire on core metrics.';
        }

        grader = {
          label,
          conclusion,
          reasons,
          warnings,
          inputs: {
            r_ihs_benchmark: rObs, r_best_questionnaire: rBest,
            delta_r2: dR2, delta_r2_p: pDR2,
            auc_ihs: aucIhs, auc_best_q: aucBest, auc_best_q_name: aucBestQName,
            ceil_ihs: ceilIhs, ceil_who5: ceilWho, ceil_swls: ceilSwl,
            rel_ihs: relIhs, rel_benchmark: relBench,
            n_effective: nEff
          },
          thresholds
        };
      } catch (_) { grader = null; }

      const payload = {
        n_used: n,
        method,
        correlation: { r, n, ci95: (ci95 ? [ci95[0], ci95[1]] : null) },
        benchmark: {
          method: 'z_mean',
          components: {
            who5: { mean: whoMean, sd: whoSd },
            swls: { mean: swlMean, sd: swlSd },
            cantril: { mean: canMean, sd: canSd }
          }
        },
        non_inferiority: nonInferiority,
        components_vs_benchmark: compsVsB,
        regression,
        reliability: { ihs_sb: ihsReliability, benchmark_omega: benchmarkOmega },
        attenuation,
        ceiling,
        roc,
        roc_aux: { who5: aucWho, swls: aucSwl, cantril: aucCan, best: aucBestQ, best_name: aucBestQName },
        robustness,
        filters_echo: { device, method, modality, exclusive, excludeTimeouts, iat, sensitivityAllMax, threshold, sex, country, countries, ageMin, ageMax, excludeCountries },
        grader
      };
      if (includePerSession) payload.perSession = perSession;
      payload.usedSessions = joined.length;
      __validityCache.set(cacheKey, { at: Date.now(), ttlMs: 60000, data: payload });
      res.json({ ...payload, cache: { hit: false } });
    } finally {
      researchClient.release();
      mainClient.release();
    }
  } catch (e) {
    console.error('Error computing validity analytics:', e);
    const debug = String(req.query.debug || '').toLowerCase() === '1';
    if (debug) {
      res.status(500).json({ error: 'Failed to compute validity analytics', message: e?.message || null, stack: e?.stack || null });
    } else {
      res.status(500).json({ error: 'Failed to compute validity analytics' });
    }
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
  
  if (!Number.isFinite(Number(ihsScore)) || !domainScores) {
    return res.status(400).json({ error: 'IHS score (number) and domain scores are required' });
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
      
      const ihsResult = await client.query(ihsPercentileQuery, [Number(ihsScore)]);
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