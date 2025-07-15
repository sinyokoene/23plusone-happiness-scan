// Test the new validation system
const https = require('https');

const PROD_URL = 'https://23plusone-happiness-scan.vercel.app';

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

async function testValidation() {
  console.log('🛡️ Testing Scan Validation System\n');
  
  // Test 1: All "No" responses (should be rejected)
  console.log('Test 1: All "No" responses');
  const allNoTest = {
    sessionId: `test-all-no-${Date.now()}`,
    cardSelections: {
      domains: [],
      selected: [],
      rejected: Array.from({length: 24}, (_, i) => i + 1),
      allResponses: Array.from({length: 24}, (_, i) => ({
        cardId: i + 1,
        domain: 'Test',
        response: false,
        responseTime: 1500
      }))
    },
    ihsScore: 0,
    completionTime: 96
  };
  
  const allNoResult = await makeHttpRequest(`${PROD_URL}/api/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(allNoTest)
  });
  
  console.log(`Status: ${allNoResult.status}`);
  console.log(`Response:`, allNoResult.data);
  console.log(`✅ Expected rejection:`, !allNoResult.ok ? 'PASS' : 'FAIL');
  
  // Test 2: All "Yes" responses (should be rejected)
  console.log('\nTest 2: All "Yes" responses');
  const allYesTest = {
    sessionId: `test-all-yes-${Date.now()}`,
    cardSelections: {
      domains: ['Basics', 'Ambition', 'Self-development', 'Vitality', 'Attraction'],
      selected: Array.from({length: 24}, (_, i) => i + 1),
      rejected: [],
      allResponses: Array.from({length: 24}, (_, i) => ({
        cardId: i + 1,
        domain: 'Test',
        response: true,
        responseTime: 1500
      }))
    },
    ihsScore: 100,
    completionTime: 96
  };
  
  const allYesResult = await makeHttpRequest(`${PROD_URL}/api/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(allYesTest)
  });
  
  console.log(`Status: ${allYesResult.status}`);
  console.log(`Response:`, allYesResult.data);
  console.log(`✅ Expected rejection:`, !allYesResult.ok ? 'PASS' : 'FAIL');
  
  // Test 3: Too fast completion (should be rejected)
  console.log('\nTest 3: Too fast completion');
  const tooFastTest = {
    sessionId: `test-too-fast-${Date.now()}`,
    cardSelections: {
      domains: ['Basics', 'Ambition'],
      selected: [1, 3, 5, 7, 9],
      rejected: [2, 4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
      allResponses: Array.from({length: 24}, (_, i) => ({
        cardId: i + 1,
        domain: i < 12 ? 'Basics' : 'Ambition',
        response: i < 5,
        responseTime: 200 // Very fast
      }))
    },
    ihsScore: 45,
    completionTime: 15 // Too fast
  };
  
  const tooFastResult = await makeHttpRequest(`${PROD_URL}/api/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tooFastTest)
  });
  
  console.log(`Status: ${tooFastResult.status}`);
  console.log(`Response:`, tooFastResult.data);
  console.log(`✅ Expected rejection:`, !tooFastResult.ok ? 'PASS' : 'FAIL');
  
  // Test 4: Valid response (should be accepted)
  console.log('\nTest 4: Valid response');
  const validTest = {
    sessionId: `test-valid-${Date.now()}`,
    cardSelections: {
      domains: ['Basics', 'Ambition', 'Self-development'],
      selected: [1, 3, 5, 7, 9, 12, 15, 18],
      rejected: [2, 4, 6, 8, 10, 11, 13, 14, 16, 17, 19, 20, 21, 22, 23, 24],
      allResponses: Array.from({length: 24}, (_, i) => ({
        cardId: i + 1,
        domain: ['Basics', 'Ambition', 'Self-development', 'Vitality', 'Attraction'][i % 5],
        response: [1, 3, 5, 7, 9, 12, 15, 18].includes(i + 1),
        responseTime: 1200 + Math.random() * 2000 // Realistic response times
      }))
    },
    ihsScore: 68.5,
    completionTime: 85
  };
  
  const validResult = await makeHttpRequest(`${PROD_URL}/api/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validTest)
  });
  
  console.log(`Status: ${validResult.status}`);
  console.log(`Response:`, validResult.data);
  console.log(`✅ Expected acceptance:`, validResult.ok ? 'PASS' : 'FAIL');
  
  console.log('\n🎯 Validation System Summary:');
  console.log(`All "No" rejection: ${!allNoResult.ok ? '✅ WORKING' : '❌ BROKEN'}`);
  console.log(`All "Yes" rejection: ${!allYesResult.ok ? '✅ WORKING' : '❌ BROKEN'}`);
  console.log(`Too fast rejection: ${!tooFastResult.ok ? '✅ WORKING' : '❌ BROKEN'}`);
  console.log(`Valid acceptance: ${validResult.ok ? '✅ WORKING' : '❌ BROKEN'}`);
}

testValidation();
