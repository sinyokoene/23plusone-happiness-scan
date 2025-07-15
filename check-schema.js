// Check actual database schema
const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://postgres.owtgssgttupuwdfdvafv:23PlusoneSUPA@aws-0-eu-west-3.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
  try {
    const client = await pool.connect();
    
    // Get table structure
    const schemaQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'scan_responses'
      ORDER BY ordinal_position;
    `;
    
    const schemaResult = await client.query(schemaQuery);
    console.log('📋 Current table schema:');
    schemaResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    // Get sample data
    const dataQuery = 'SELECT * FROM scan_responses LIMIT 2';
    const dataResult = await client.query(dataQuery);
    console.log('\n📊 Sample data:');
    console.log(dataResult.rows);
    
    client.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ Schema check failed:', err.message);
    process.exit(1);
  }
}

checkSchema();
