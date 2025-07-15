#!/usr/bin/env node
const { Pool } = require('pg');

// Use your Supabase connection
const DATABASE_URL = 'postgresql://postgres.owtgssgttupuwdfdvafv:23PlusoneSUPA@aws-0-eu-west-3.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkSupabaseAndBenchmark() {
  try {
    console.log('🔍 Connecting to Supabase...');
    const client = await pool.connect();
    
    try {
      // Check current table structure
      console.log('\n📋 Current table schema:');
      const schemaQuery = `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'scan_responses'
        ORDER BY ordinal_position;
      `;
      
      const schema = await client.query(schemaQuery);
      schema.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'required'})`);
      });
      
      // Check current data
      console.log('\n📊 Current data overview:');
      const dataQuery = `
        SELECT 
          COUNT(*) as total_rows,
          COUNT(CASE WHEN ihs_score IS NOT NULL THEN 1 END) as rows_with_ihs,
          MIN(ihs_score) as min_ihs,
          MAX(ihs_score) as max_ihs,
          AVG(ihs_score) as avg_ihs
        FROM scan_responses;
      `;
      
      const dataResult = await client.query(dataQuery);
      const stats = dataResult.rows[0];
      console.log(`  Total rows: ${stats.total_rows}`);
      console.log(`  Rows with IHS: ${stats.rows_with_ihs}`);
      console.log(`  IHS range: ${stats.min_ihs} - ${stats.max_ihs}`);
      console.log(`  Average IHS: ${stats.avg_ihs}`);
      
      // Sample recent entries
      console.log('\n📝 Recent 5 entries:');
      const sampleQuery = `
        SELECT id, created_at, ihs_score, session_id, selected_count
        FROM scan_responses 
        ORDER BY created_at DESC 
        LIMIT 5;
      `;
      
      const samples = await client.query(sampleQuery);
      samples.rows.forEach((row, i) => {
        console.log(`  ${i+1}. ID:${row.id} IHS:${row.ihs_score} Session:${row.session_id} Selected:${row.selected_count}`);
      });
      
      // Test benchmark calculation for a sample score
      const testScore = 75.5;
      console.log(`\n🎯 Testing benchmark for IHS score: ${testScore}`);
      
      const benchmarkQuery = `
        SELECT 
          COUNT(*) as total_responses,
          COUNT(CASE WHEN ihs_score < $1 THEN 1 END) as lower_scores
        FROM scan_responses 
        WHERE ihs_score IS NOT NULL;
      `;
      
      const benchmarkResult = await client.query(benchmarkQuery, [testScore]);
      const { total_responses, lower_scores } = benchmarkResult.rows[0];
      
      const percentile = total_responses > 0 ? Math.round((parseInt(lower_scores) / parseInt(total_responses)) * 100) : 0;
      
      console.log(`  Total responses with IHS: ${total_responses}`);
      console.log(`  Scores lower than ${testScore}: ${lower_scores}`);
      console.log(`  Calculated percentile: ${percentile}th percentile`);
      
      // Generate message based on percentile
      let message = '';
      if (percentile >= 90) {
        message = `Outstanding! You're in the top ${100 - percentile}% - that's exceptional happiness levels! 🌟`;
      } else if (percentile >= 75) {
        message = `Great news! You're happier than ${percentile}% of people who took this scan 😊`;
      } else if (percentile >= 50) {
        message = `You're doing well - happier than ${percentile}% of people, with room to grow 🌱`;
      } else if (percentile >= 25) {
        message = `Your happiness is ${percentile}th percentile - there's opportunity to flourish 💪`;
      } else {
        message = `You're at the ${percentile}th percentile - every small step towards happiness counts 🌈`;
      }
      
      console.log(`  Generated message: "${message}"`);
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

checkSupabaseAndBenchmark();
