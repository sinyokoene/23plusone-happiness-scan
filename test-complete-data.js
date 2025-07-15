// Test the complete data structure
const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://postgres.owtgssgttupuwdfdvafv:23PlusoneSUPA@aws-0-eu-west-3.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkCompleteDataStructure() {
  try {
    const client = await pool.connect();
    
    console.log('🔍 Checking what data we currently have...');
    
    // Check the most recent entry to see its structure
    const result = await client.query(`
      SELECT 
        id,
        session_id,
        card_selections,
        ihs_score,
        completion_time,
        created_at
      FROM scan_responses 
      ORDER BY created_at DESC 
      LIMIT 3
    `);
    
    console.log('\n📊 Recent database entries:');
    result.rows.forEach((row, index) => {
      console.log(`\n--- Entry ${index + 1} (ID: ${row.id}) ---`);
      console.log('Session:', row.session_id);
      console.log('IHS Score:', row.ihs_score);
      console.log('Completion Time:', row.completion_time, 'seconds');
      console.log('Created:', row.created_at);
      
      const selections = row.card_selections;
      console.log('\nCard Selections Structure:');
      console.log('- Domains:', selections.domains?.length || 'N/A');
      console.log('- Selected Cards:', selections.selected?.length || 'N/A');
      console.log('- Rejected Cards:', selections.rejected?.length || 'N/A');
      console.log('- All Responses:', selections.allResponses?.length || 'N/A');
      
      if (selections.allResponses) {
        console.log('\nSample responses:');
        selections.allResponses.slice(0, 3).forEach(resp => {
          console.log(`  Card ${resp.cardId} (${resp.domain}): ${resp.response ? 'YES' : 'NO'} in ${resp.responseTime}ms`);
        });
      }
    });
    
    client.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ Check failed:', err.message);
    process.exit(1);
  }
}

checkCompleteDataStructure();
