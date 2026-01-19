require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const { pool } = require('./db/pool');
const { runStartupMigrations } = require('./db/migrations');

const healthRouter = require('./routes/health');
const reportRouter = require('./routes/report');
const scanRouter = require('./routes/scan');
const researchRouter = require('./routes/research');
const analyticsRouter = require('./routes/analytics');
const prolificRouter = require('./routes/prolific');

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
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Preview route: render report HTML with provided base64 data
app.get('/report/preview', (req, res) => {
  // serve static file; client-side script reads ?data=
  res.sendFile(path.join(__dirname, '../public/report.html'));
});

// API routes
app.use('/api', healthRouter);
app.use('/api', reportRouter);
app.use('/api', scanRouter);
app.use('/api', researchRouter);
app.use('/api', analyticsRouter);
app.use('/api/prolific', prolificRouter);

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

// Async startup: run migrations before accepting requests
async function startServer() {
  try {
    // Wait for migrations to complete before starting server
    await runStartupMigrations(pool);
    
    // On Vercel, export the Express app as a serverless function handler.
    // Locally, start the HTTP server.
    if (!IS_VERCEL) {
      app.listen(PORT, () => {
        console.log(`🚀 23plusone Happiness Scan server running on port ${PORT}`);
        console.log(`📊 Visit http://localhost:${PORT} to test the scan`);
        console.log(`🔗 Embed URL: http://localhost:${PORT}/scan.html`);
      });
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start server (only if not in Vercel - Vercel uses serverless functions)
if (!IS_VERCEL) {
  startServer();
}

module.exports = app;

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  pool.end(() => {
    process.exit(0);
  });
});
