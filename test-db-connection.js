// Quick database connection test
const { Pool } = require('pg');

// Replace with your actual DATABASE_URL
const DATABASE_URL = 'postgresql://postgres.owlgsgtlupuwdfvafv:YOUR_PASSWORD@aws-0-us-west-1.pooler.supabase.co:6543/postgres';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Database connection successful!');
    
    const result = await client.query('SELECT COUNT(*) FROM scan_responses');
    console.log('📊 Current responses in database:', result.rows[0].count);
    
    client.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }
}

testConnection();
