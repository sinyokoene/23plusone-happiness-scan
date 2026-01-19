const express = require('express');

const { pool } = require('../db/pool');
const { isDuplicateSession, validateScanQuality } = require('../lib/scan-validation');

const router = express.Router();

// Post a scan response
router.post('/responses', async (req, res) => {
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

    // Compute server-authoritative N1 scaled (0–100) from raw selections
    function computeN1Scaled(allResponses) {
      if (!Array.isArray(allResponses) || allResponses.length === 0) return { scaled: null, trials: 0 };
      const trials = allResponses.length;
      const timeMultiplier = (ms) => { const t = Math.max(0, Math.min(4000, Number(ms) || 0)); const lin = (4000 - t) / 4000; return Math.sqrt(Math.max(0, lin)); };
      let sum = 0;
      for (const e of allResponses) {
        if (!e) continue;
        if (e.response === true) {
          const t = Number(e.responseTime);
          if (Number.isFinite(t)) sum += 4 * timeMultiplier(t);
          // missing/NaN time contributes 0
        }
      }
      const denom = 4 * Math.max(1, trials);
      const scaled = Math.max(0, Math.min(100, (100 * sum) / denom));
      return { scaled, trials };
    }

    const client = await pool.connect();

    try {
      // Duplicate session protection
      if (await isDuplicateSession(client, sessionId)) {
        return res.status(409).json({ error: 'Duplicate submission', reason: 'Session already submitted' });
      }
      // Insert scan response (IP column removed)
      const all = (cardSelections && Array.isArray(cardSelections.allResponses)) ? cardSelections.allResponses : [];
      const n1calc = computeN1Scaled(all);
      const result = await client.query(
        `INSERT INTO scan_responses 
         (session_id, card_selections, ihs_score, n1_score, n2_score, n3_score, completion_time, user_agent, selected_count, rejected_count, n1_scaled_100, n1_trials_total, n1_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
          cardSelections?.rejected?.length || 0,
          n1calc.scaled,
          n1calc.trials,
          2
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

// Get benchmark percentiles
router.get('/benchmarks', async (req, res) => {
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
router.get('/stats', async (req, res) => {
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
router.post('/benchmarks', async (req, res) => {
  console.log('📊 Benchmark request received:', JSON.stringify(req.body, null, 2));

  const { ihsScore, domainScores } = req.body;

  if (!Number.isFinite(Number(ihsScore)) || !domainScores) {
    return res.status(400).json({ error: 'IHS score (number) and domain scores are required' });
  }

  try {
    const client = await pool.connect();

    try {
      // Calculate overall N1 (0–100) percentile
      const ihsPercentileQuery = `
        SELECT 
          COUNT(*) as total_responses,
          COUNT(CASE WHEN n1_scaled_100 < $1 THEN 1 END) as lower_scores
        FROM scan_responses 
        WHERE n1_scaled_100 IS NOT NULL
      `;

      const ihsResult = await client.query(ihsPercentileQuery, [Number(ihsScore)]);
      const totalResponses = parseInt(ihsResult.rows[0].total_responses);
      const lowerScores = parseInt(ihsResult.rows[0].lower_scores);

      let ihsPercentile = 0;
      if (totalResponses > 0) {
        ihsPercentile = Math.round((lowerScores / totalResponses) * 100);
      }

      // Domain percentiles removed - not used by frontend and always showing 0

      // Get some additional context stats (N1 based)
      const contextQuery = `
        SELECT 
          AVG(n1_scaled_100) as avg_ihs,
          STDDEV(n1_scaled_100) as stddev_ihs,
          MIN(n1_scaled_100) as min_ihs,
          MAX(n1_scaled_100) as max_ihs
        FROM scan_responses 
        WHERE n1_scaled_100 IS NOT NULL
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

// Admin backfill for n1_scaled_100 (requires x-admin-token header matching ADMIN_TOKEN)
router.post('/admin/backfill-n1', async (req, res) => {
  try {
    const token = req.headers['x-admin-token'];
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const limit = Math.min(parseInt(String(req.query.limit || '5000'), 10) || 5000, 20000);
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, card_selections FROM scan_responses
         WHERE n1_scaled_100 IS NULL AND card_selections IS NOT NULL
         ORDER BY id DESC
         LIMIT $1`, [limit]
      );
      function computeN1Scaled(all) {
        if (!Array.isArray(all) || all.length === 0) return { scaled: null, trials: 0 };
        const trials = all.length;
        const timeMultiplier = (ms) => { const t = Math.max(0, Math.min(4000, Number(ms) || 0)); const lin = (4000 - t) / 4000; return Math.sqrt(Math.max(0, lin)); };
        let sum = 0;
        for (const e of all) {
          if (!e) continue;
          if (e.response === true) {
            const t = Number(e.responseTime);
            if (Number.isFinite(t)) sum += 4 * timeMultiplier(t);
          }
        }
        const denom = 4 * Math.max(1, trials);
        const scaled = Math.max(0, Math.min(100, (100 * sum) / denom));
        return { scaled, trials };
      }
      let updated = 0;
      for (const r of rows) {
        const all = r.card_selections?.allResponses;
        if (!Array.isArray(all)) continue;
        const n1 = computeN1Scaled(all);
        await client.query(
          `UPDATE scan_responses SET n1_scaled_100=$1, n1_trials_total=$2, n1_version=2 WHERE id=$3`,
          [n1.scaled, n1.trials, r.id]
        );
        updated++;
      }
      res.json({ updated });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Backfill n1_scaled_100 failed', e);
    res.status(500).json({ error: 'Backfill failed' });
  }
});

module.exports = router;
