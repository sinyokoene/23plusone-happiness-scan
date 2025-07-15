// Test just the stats query locally
const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://postgres.owtgssgttupuwdfdvafv:23PlusoneSUPA@aws-0-eu-west-3.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testStatsQuery() {
  try {
    const client = await pool.connect();
    
    console.log('🔍 Testing stats query...');
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
    
    console.log('✅ Stats query successful:', result.rows[0]);
    
    const stats = result.rows[0];
    const response = {
      totalResponses: parseInt(stats.total_responses),
      averageIHS: stats.avg_ihs ? Math.round(parseFloat(stats.avg_ihs) * 10) / 10 : null,
      minIHS: stats.min_ihs ? Math.round(parseFloat(stats.min_ihs) * 10) / 10 : null,
      maxIHS: stats.max_ihs ? Math.round(parseFloat(stats.max_ihs) * 10) / 10 : null,
      averageCompletionTime: stats.avg_completion_time ? Math.round(parseFloat(stats.avg_completion_time)) : null
    };
    
    console.log('📊 Formatted response:', response);
    
    client.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ Stats query failed:', err.message);
    process.exit(1);
  }
}

testStatsQuery();
