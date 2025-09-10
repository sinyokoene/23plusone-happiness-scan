require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

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

// Runtime schema feature detection (local vs Supabase differences)
let hasIpAddressColumn = null; // lazily detected
async function detectSchemaFeatures(client) {
  if (hasIpAddressColumn !== null) return;
  try {
    const res = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='scan_responses' AND column_name='ip_address'`
    );
    hasIpAddressColumn = res.rowCount > 0;
    console.log(`🧭 Schema detection: ip_address ${hasIpAddressColumn ? 'present' : 'absent'}`);
  } catch (e) {
    hasIpAddressColumn = false;
    console.warn('Schema detection failed; assuming no ip_address column');
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env_check: process.env.DATABASE_URL ? 'DB_URL_SET' : 'DB_URL_MISSING'
  });
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
  
  // Reject all "Yes" responses (24 selected) - clearly clicking through
  if (selectedCount === 24) {
    console.log('❌ All Yes responses');
    return { isValid: false, reason: 'All responses were "Yes" - likely clicking through' };
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
      // Detect schema once and insert accordingly
      await detectSchemaFeatures(client);
      let result;
      if (hasIpAddressColumn) {
        result = await client.query(
          `INSERT INTO scan_responses 
           (session_id, card_selections, ihs_score, n1_score, n2_score, n3_score, completion_time, user_agent, ip_address, selected_count, rejected_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
            req.ip || null,
            cardSelections?.selected?.length || 0,
            cardSelections?.rejected?.length || 0
          ]
        );
      } else {
        result = await client.query(
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
      }
      
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
    const { sessionId, who5, swls, userAgent } = req.body || {};
    if (!sessionId || !Array.isArray(who5) || !Array.isArray(swls)) {
      return res.status(400).json({ error: 'Invalid research payload' });
    }
    const client = await researchPool.connect();
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS research_entries (
          id SERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          who5 INTEGER[] NOT NULL,
          swls INTEGER[] NOT NULL,
          user_agent TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )`
      );
      await client.query(
        `INSERT INTO research_entries (session_id, who5, swls, user_agent) VALUES ($1,$2,$3,$4)`,
        [sessionId, who5, swls, userAgent || null]
      );
      res.status(201).json({ message: 'Research saved' });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Error saving research:', e);
    res.status(500).json({ error: 'Failed to save research' });
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