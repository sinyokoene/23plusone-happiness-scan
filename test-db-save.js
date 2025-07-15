// Comprehensive database save test
const { Pool } = require('pg');
const https = require('https');

// Test production environment
const PROD_URL = 'https://23plusone-happiness-scan.vercel.app';

const DATABASE_URL = 'postgresql://postgres.owtgssgttupuwdfdvafv:23PlusoneSUPA@aws-0-eu-west-3.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test data matching actual schema: timestamp, card_id, domain, yes_no, response_time, ihs
const testScanData = [
  { card_id: 1, domain: 'Health', yes_no: true, response_time: 2500, ihs: 75.5 },
  { card_id: 2, domain: 'Relationships', yes_no: false, response_time: 1800, ihs: 75.5 },
  { card_id: 3, domain: 'Work', yes_no: true, response_time: 3200, ihs: 75.5 }
];

async function testDirectDatabase() {
  console.log('\n🔍 Testing Direct Database Connection...');
  try {
    const client = await pool.connect();
    console.log('✅ Direct connection successful');
    
    // Get current count
    const beforeResult = await client.query('SELECT COUNT(*) FROM scan_responses');
    const beforeCount = parseInt(beforeResult.rows[0].count);
    console.log(`📊 Responses before test: ${beforeCount}`);
    
    // Insert test data using correct schema
    const timestamp = new Date().toISOString();
    
    for (const data of testScanData) {
      const insertQuery = `
        INSERT INTO scan_responses (timestamp, card_id, domain, yes_no, response_time, ihs)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `;
      
      const result = await client.query(insertQuery, [
        timestamp,
        data.card_id,
        data.domain,
        data.yes_no,
        data.response_time,
        data.ihs
      ]);
      
      console.log(`✅ Test record inserted with ID: ${result.rows[0].id}`);
    }
    
    // Verify count increased
    const afterResult = await client.query('SELECT COUNT(*) FROM scan_responses');
    const afterCount = parseInt(afterResult.rows[0].count);
    console.log(`📊 Responses after test: ${afterCount}`);
    
    if (afterCount === beforeCount + testScanData.length) {
      console.log('✅ Database save test PASSED');
    } else {
      console.log('❌ Database save test FAILED');
    }
    
    client.release();
    return true;
  } catch (err) {
    console.error('❌ Direct database test failed:', err.message);
    return false;
  }
}

function makeHttpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ ok: res.statusCode < 400, status: res.statusCode, data: jsonData });
        } catch (err) {
          resolve({ ok: res.statusCode < 400, status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

async function testProductionAPI() {
  console.log('\n🌐 Testing Production API...');
  try {
    // Test health endpoint
    const healthResponse = await makeHttpRequest(`${PROD_URL}/api/health`);
    console.log('📡 Health check:', healthResponse.data);
    
    // Test debug endpoint
    const debugResponse = await makeHttpRequest(`${PROD_URL}/api/debug`);
    console.log('🔍 Debug info:', debugResponse.data);
    
    // Test actual submission with correct data format
    const submitResponse = await makeHttpRequest(`${PROD_URL}/api/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        responses: testScanData,
        totalTime: 45.2,
        ihsScore: 75.5
      })
    });
    
    console.log('📤 Submission result:', submitResponse.data);
    
    if (submitResponse.ok) {
      console.log('✅ Production API test PASSED');
      return true;
    } else {
      console.log('❌ Production API test FAILED');
      return false;
    }
    
  } catch (err) {
    console.error('❌ Production API test failed:', err.message);
    return false;
  }
}

async function runComprehensiveTest() {
  console.log('🚀 Starting Comprehensive Database Test\n');
  console.log('='.repeat(50));
  
  const directDbSuccess = await testDirectDatabase();
  const prodApiSuccess = await testProductionAPI();
  
  console.log('\n' + '='.repeat(50));
  console.log('📋 FINAL RESULTS:');
  console.log(`Direct Database: ${directDbSuccess ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Production API: ${prodApiSuccess ? '✅ PASS' : '❌ FAIL'}`);
  
  if (directDbSuccess && !prodApiSuccess) {
    console.log('\n🔧 DIAGNOSIS: Database works locally but Vercel environment variable issue persists');
    console.log('💡 SOLUTION: Need to fix Vercel environment variable configuration');
  } else if (directDbSuccess && prodApiSuccess) {
    console.log('\n🎉 SUCCESS: Everything is working correctly!');
  } else {
    console.log('\n⚠️  ISSUE: Database connection problems detected');
  }
  
  process.exit(0);
}

runComprehensiveTest();
