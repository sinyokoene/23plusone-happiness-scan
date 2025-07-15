#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');

async function checkSupabaseDatabase() {
  console.log('🔄 Connecting to Supabase database...');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Test connection
    console.log('📡 Testing connection...');
    const client = await pool.connect();
    
    // Check what tables exist
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('📋 Available tables:');
    tables.rows.forEach(row => console.log(`  - ${row.table_name}`));
    
    // Check scan_responses table structure
    if (tables.rows.some(r => r.table_name === 'scan_responses')) {
      const columns = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'scan_responses' 
        ORDER BY ordinal_position
      `);
      
      console.log('\n📊 scan_responses table structure:');
      columns.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
      });
      
      // Check current data
      const dataCheck = await client.query(`
        SELECT 
          COUNT(*) as total_responses,
          COUNT(CASE WHEN ihs_score IS NOT NULL THEN 1 END) as responses_with_ihs,
          MIN(ihs_score) as min_ihs,
          MAX(ihs_score) as max_ihs,
          AVG(ihs_score) as avg_ihs
        FROM scan_responses
      `);
      
      const stats = dataCheck.rows[0];
      console.log('\n📈 Current data in Supabase:');
      console.log(`  - Total responses: ${stats.total_responses}`);
      console.log(`  - Responses with IHS score: ${stats.responses_with_ihs}`);
      
      if (stats.responses_with_ihs > 0) {
        console.log(`  - IHS Score range: ${stats.min_ihs} - ${stats.max_ihs}`);
        console.log(`  - Average IHS: ${Math.round(parseFloat(stats.avg_ihs) * 10) / 10}`);
        
        // Test benchmark calculation for a sample score
        const testScore = 75;
        const benchmarkTest = await client.query(`
          SELECT 
            COUNT(*) as total_responses,
            COUNT(CASE WHEN ihs_score < $1 THEN 1 END) as lower_scores
          FROM scan_responses 
          WHERE ihs_score IS NOT NULL
        `, [testScore]);
        
        const total = parseInt(benchmarkTest.rows[0].total_responses);
        const lower = parseInt(benchmarkTest.rows[0].lower_scores);
        const percentile = total > 0 ? Math.round((lower / total) * 100) : 0;
        
        console.log(`\n🎯 Benchmark test (score ${testScore}):`);
        console.log(`  - Would be ${percentile}th percentile`);
        console.log(`  - Better than ${lower} out of ${total} responses`);
      } else {
        console.log('⚠️  No responses with IHS scores found');
      }
      
    } else {
      console.log('❌ scan_responses table not found');
      
      // Create the table if it doesn't exist
      console.log('🔧 Creating scan_responses table...');
      await client.query(`
        CREATE TABLE scan_responses (
          id SERIAL PRIMARY KEY,
          session_id TEXT,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          card_selections JSONB,
          ihs_score REAL,
          n1_score REAL,
          n2_score REAL, 
          n3_score REAL,
          domain_scores JSONB,
          completion_time INTEGER,
          user_agent TEXT,
          total_cards INTEGER DEFAULT 24,
          selected_count INTEGER,
          rejected_count INTEGER,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      console.log('✅ Table created successfully');
    }
    
    client.release();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSupabaseDatabase();
