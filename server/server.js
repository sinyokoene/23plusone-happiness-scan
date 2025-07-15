require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

// Force deployment update - July 15, 2025
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

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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

// Post a scan response
app.post('/api/responses', async (req, res) => {
  try {
    const { timestamp, responses, ihs } = req.body;
    
    // Validation
    if (!timestamp || !responses || !Array.isArray(responses) || typeof ihs !== 'number') {
      return res.status(400).json({ error: 'Invalid request format' });
    }
    
    if (responses.length === 0) {
      return res.status(400).json({ error: 'No responses provided' });
    }
    
    const client = await pool.connect();
    
    try {
      // Begin transaction
      await client.query('BEGIN');
      
      // Insert each answer row
      const insertPromises = responses.map(r => {
        if (!r.id || !r.domain || typeof r.yes !== 'boolean' || typeof r.time !== 'number') {
          throw new Error('Invalid response format');
        }
        
        return client.query(
          `INSERT INTO scan_responses 
           (timestamp, card_id, domain, yes_no, response_time, ihs)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [timestamp, r.id, r.domain, r.yes, r.time, ihs]
        );
      });
      
      await Promise.all(insertPromises);
      
      // Commit transaction
      await client.query('COMMIT');
      
      res.status(201).json({ 
        message: 'Responses saved successfully',
        count: responses.length 
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error('Error saving responses:', err);
    res.status(500).json({ error: 'Failed to save responses' });
  }
});

// Get benchmark percentiles
app.get('/api/benchmarks', async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      // Check if we have enough data for meaningful percentiles
      const countResult = await client.query(
        'SELECT COUNT(DISTINCT timestamp) as response_count FROM scan_responses'
      );
      
      const responseCount = parseInt(countResult.rows[0].response_count);
      
      if (responseCount < 10) {
        return res.json({ 
          percentiles: null,
          message: 'Insufficient data for benchmarks',
          responseCount 
        });
      }
      
      // Compute percentiles from unique IHS scores (one per response session)
      const result = await client.query(`
        SELECT 
          percentile_cont(ARRAY[0.1, 0.25, 0.5, 0.75, 0.9]) 
            WITHIN GROUP (ORDER BY ihs) AS percentiles
        FROM (
          SELECT DISTINCT timestamp, ihs 
          FROM scan_responses 
          WHERE ihs IS NOT NULL
        ) unique_responses
      `);
      
      const percentiles = result.rows[0].percentiles;
      
      res.json({ 
        percentiles: percentiles ? percentiles.map(p => Math.round(p * 10) / 10) : null,
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
          COUNT(DISTINCT timestamp) as total_responses,
          AVG(ihs) as avg_ihs,
          MIN(ihs) as min_ihs,
          MAX(ihs) as max_ihs,
          COUNT(*) as total_answers
        FROM scan_responses
        WHERE ihs IS NOT NULL
      `);
      
      const stats = result.rows[0];
      
      res.json({
        totalResponses: parseInt(stats.total_responses),
        totalAnswers: parseInt(stats.total_answers),
        averageIHS: stats.avg_ihs ? Math.round(stats.avg_ihs * 10) / 10 : null,
        minIHS: stats.min_ihs ? Math.round(stats.min_ihs * 10) / 10 : null,
        maxIHS: stats.max_ihs ? Math.round(stats.max_ihs * 10) / 10 : null
      });
      
    } finally {
      client.release();
    }
    
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
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

app.listen(PORT, () => {
  console.log(`🚀 23plusone Happiness Scan server running on port ${PORT}`);
  console.log(`📊 Visit http://localhost:${PORT} to test the scan`);
  console.log(`🔗 Embed URL: http://localhost:${PORT}/scan.html`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  pool.end(() => {
    process.exit(0);
  });
});