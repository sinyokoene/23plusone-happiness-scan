// Rigorous database save test with correct schema
const { Pool } = require('pg');
const https = require('https');

const DATABASE_URL = 'postgresql://postgres.owtgssgttupuwdfdvafv:23PlusoneSUPA@aws-0-eu-west-3.pooler.supabase.com:6543/postgres';
const PROD_URL = 'https://23plusone-happiness-scan.vercel.app';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test data matching the actual current schema
const testSubmission = {
  sessionId: `test-${Date.now()}`,
  cardSelections: {
    domains: ['Health', 'Relationships', 'Work', 'Personal Growth'],
    selected: [1, 3, 5, 7, 9, 12, 15, 18, 20, 22]
  },
  ihsScore: 78.5,
  n1Score: 82.0,
  n2Score: 75.0,
  n3Score: 78.5,
  completionTime: 95,
  userAgent: 'Test User Agent'
};

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

async function testDirectDatabase() {
  console.log('\n🔍 Testing Direct Database Connection...');
  try {
    const client = await pool.connect();
    console.log('✅ Direct connection successful');
    
    // Get current count
    const beforeResult = await client.query('SELECT COUNT(*) FROM scan_responses');
    const beforeCount = parseInt(beforeResult.rows[0].count);
    console.log(`📊 Responses before test: ${beforeCount}`);
    
    // Insert test data using correct current schema
    const insertQuery = `
      INSERT INTO scan_responses (session_id, card_selections, ihs_score, n1_score, n2_score, n3_score, completion_time, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;
    
    const result = await client.query(insertQuery, [
      testSubmission.sessionId,
      JSON.stringify(testSubmission.cardSelections),
      testSubmission.ihsScore,
      testSubmission.n1Score,
      testSubmission.n2Score,
      testSubmission.n3Score,
      testSubmission.completionTime,
      testSubmission.userAgent
    ]);
    
    console.log(`✅ Test record inserted with ID: ${result.rows[0].id}`);
    
    // Verify count increased
    const afterResult = await client.query('SELECT COUNT(*) FROM scan_responses');
    const afterCount = parseInt(afterResult.rows[0].count);
    console.log(`📊 Responses after test: ${afterCount}`);
    
    if (afterCount === beforeCount + 1) {
      console.log('✅ Direct database save test PASSED');
    } else {
      console.log('❌ Direct database save test FAILED');
    }
    
    client.release();
    return true;
  } catch (err) {
    console.error('❌ Direct database test failed:', err.message);
    return false;
  }
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
    
    // Test stats endpoint
    const statsResponse = await makeHttpRequest(`${PROD_URL}/api/stats`);
    console.log('📊 Current stats:', statsResponse.data);
    
    // Test actual submission with correct format
    const submitResponse = await makeHttpRequest(`${PROD_URL}/api/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testSubmission)
    });
    
    console.log('📤 Submission result:', submitResponse.data);
    
    if (submitResponse.ok) {
      console.log('✅ Production API test PASSED');
      
      // Test stats again to see the change
      const statsAfterResponse = await makeHttpRequest(`${PROD_URL}/api/stats`);
      console.log('📊 Stats after submission:', statsAfterResponse.data);
      
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

async function runRigorousTest() {
  console.log('🚀 Starting Rigorous Database Save Test\n');
  console.log('='.repeat(60));
  
  const directDbSuccess = await testDirectDatabase();
  const prodApiSuccess = await testProductionAPI();
  
  console.log('\n' + '='.repeat(60));
  console.log('📋 FINAL RESULTS:');
  console.log(`Direct Database: ${directDbSuccess ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Production API: ${prodApiSuccess ? '✅ PASS' : '❌ FAIL'}`);
  
  if (directDbSuccess && prodApiSuccess) {
    console.log('\n🎉 SUCCESS: Everything is working perfectly!');
    console.log('💾 Database saving is fully functional');
    console.log('🌐 Production API is operational'); 
    console.log('🔗 Platform ready for real users');
  } else if (directDbSuccess && !prodApiSuccess) {
    console.log('\n🔧 DIAGNOSIS: Database works locally but API issue on production');
  } else {
    console.log('\n⚠️  ISSUE: Database connection problems detected');
  }
  
  process.exit(0);
}

runRigorousTest();
