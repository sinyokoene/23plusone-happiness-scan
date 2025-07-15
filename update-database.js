#!/usr/bin/env node
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function updateDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://sinyo@localhost:5432/happiness_benchmark',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔄 Connecting to database...');
    
    // First, check if we need to migrate existing data
    const checkExisting = await pool.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_name = 'scan_responses'
    `);
    
    const tableExists = parseInt(checkExisting.rows[0].count) > 0;
    console.log(`📋 Table exists: ${tableExists}`);
    
    if (tableExists) {
      // Check current schema
      const columns = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'scan_responses'
      `);
      
      console.log('📊 Current columns:', columns.rows.map(r => r.column_name));
      
      // If we have the old schema, we need to migrate
      const hasOldSchema = columns.rows.some(r => r.column_name === 'card_id');
      
      if (hasOldSchema) {
        console.log('🔄 Migrating old schema...');
        
        // Rename old table to backup
        await pool.query('ALTER TABLE scan_responses RENAME TO scan_responses_backup');
        console.log('✅ Backed up old table');
      }
    }
    
    // Read and execute new schema
    const schemaPath = path.join(__dirname, 'db', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('📝 Executing new schema...');
    await pool.query(schema);
    console.log('✅ Database schema updated successfully!');
    
    // Test the schema
    const testQuery = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'scan_responses' 
      ORDER BY ordinal_position
    `);
    
    console.log('📋 New schema columns:');
    testQuery.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
  } catch (error) {
    console.error('❌ Database update failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

updateDatabase();
