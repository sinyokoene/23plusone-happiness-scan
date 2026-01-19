const express = require('express');

const { pool } = require('../db/pool');
const { buildTransport } = require('../lib/mail');

const router = express.Router();

// Request full report: receives client-generated PDF and emails it
router.post('/report', async (req, res) => {
  try {
    const { email, sessionId, results, marketing } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // Require client-provided PDF
    const pdfBase64 = typeof req.body?.pdfBase64 === 'string' ? req.body.pdfBase64 : null;
    if (!pdfBase64) {
      return res.status(400).json({ error: 'Missing pdfBase64' });
    }

    let pdfBuffer;
    try {
      const base64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      pdfBuffer = Buffer.from(base64, 'base64');
    } catch (_) {
      return res.status(400).json({ error: 'Invalid pdfBase64' });
    }

    // Send email
    const from = process.env.MAIL_FROM || 'no-reply@23plusone.org';
    const transport = buildTransport();
    const info = await transport.sendMail({
      from,
      to: email,
      subject: 'Your 23plusone Happiness Scan',
      text: `Hello!

Thanks for taking part. Attached you'll find your 23plusone Happiness Scan — a short, behavioural snapshot of the drives that currently influence your motivation and well-being. The scan doesn't ask you to explain or rate how happy you feel; instead, it looks at what you instinctively resonate with right now. See this as a moment-in-time reflection, not a verdict. There's no right or wrong outcome — the value sits in the pattern across domains and the conversations it might spark. If you have questions or want to explore the results further, feel free to reach out.

Best,

BR-ND People`,
      attachments: [{ filename: '23plusone-report.pdf', content: pdfBuffer }]
    });

    // Optionally store marketing opt-in; simple log for now
    try { if (marketing) console.log('Marketing opt-in from', email, sessionId || 'n/a'); } catch (_) {}

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

// Build payload for report by sessionId (for preview without base64)
router.get('/report-payload', async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const client = await pool.connect();
    try {
      const row = (await client.query(
        `SELECT ihs_score, n1_score, n2_score, n3_score, n1_scaled_100, completion_time, card_selections
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
      // Benchmark context (using N1/n1_scaled_100 to match live benchmarks)
      let benchmark = null;
      try {
        const score = row.n1_scaled_100 != null ? Number(row.n1_scaled_100) : (row.n1_score != null ? Number(row.n1_score) : null);
        if (score != null) {
          const ihsResult = await client.query(
            `SELECT COUNT(*) as total, COUNT(CASE WHEN n1_scaled_100 < $1 THEN 1 END) as lower FROM scan_responses WHERE n1_scaled_100 IS NOT NULL`, [score]
          );
          const total = parseInt(ihsResult.rows[0].total || 0);
          const lower = parseInt(ihsResult.rows[0].lower || 0);
          const percentile = total > 0 ? Math.round((lower / total) * 100) : 0;
          const ctx = await client.query(`SELECT AVG(n1_scaled_100) as avg_score FROM scan_responses WHERE n1_scaled_100 IS NOT NULL`);
          benchmark = { ihsPercentile: percentile, context: { averageScore: ctx.rows[0].avg_score ? Math.round(parseFloat(ctx.rows[0].avg_score) * 10) / 10 : null } };
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

module.exports = router;
