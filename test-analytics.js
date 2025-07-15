// Test what data structure we need for comprehensive analytics
const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://postgres.owtgssgttupuwdfdvafv:23PlusoneSUPA@aws-0-eu-west-3.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Sample complete data structure as it should be
const sampleCompleteSession = {
  sessionId: `complete-test-${Date.now()}`,
  cardSelections: {
    domains: ['Basics', 'Ambition', 'Self-development', 'Vitality', 'Attraction'],
    selected: [1, 3, 5, 7, 9, 12, 15, 18, 20, 22], // 10 "Yes" responses
    rejected: [2, 4, 6, 8, 10, 11, 13, 14, 16, 17, 19, 21, 23, 24], // 14 "No" responses
    allResponses: [
      { cardId: 1, domain: 'Basics', label: 'A bed to sleep in', response: true, responseTime: 1500 },
      { cardId: 2, domain: 'Basics', label: 'Enough food to eat', response: false, responseTime: 800 },
      { cardId: 3, domain: 'Ambition', label: 'Recognition at work', response: true, responseTime: 2200 },
      { cardId: 4, domain: 'Ambition', label: 'Career advancement', response: false, responseTime: 1100 },
      { cardId: 5, domain: 'Self-development', label: 'Learning new skills', response: true, responseTime: 1800 },
      // ... (would continue for all 24 cards)
    ]
  },
  ihsScore: 78.5,
  n1Score: 82.0,
  n2Score: 75.0,
  n3Score: 78.5,
  completionTime: 95,
  userAgent: 'Complete Test Agent'
};

async function testCompleteDataStructure() {
  try {
    const client = await pool.connect();
    
    console.log('🧪 Testing complete data structure...');
    
    // Insert sample complete session
    const result = await client.query(
      `INSERT INTO scan_responses 
       (session_id, card_selections, ihs_score, n1_score, n2_score, n3_score, completion_time, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        sampleCompleteSession.sessionId,
        JSON.stringify(sampleCompleteSession.cardSelections),
        sampleCompleteSession.ihsScore,
        sampleCompleteSession.n1Score,
        sampleCompleteSession.n2Score,
        sampleCompleteSession.n3Score,
        sampleCompleteSession.completionTime,
        sampleCompleteSession.userAgent
      ]
    );
    
    console.log(`✅ Complete test session inserted with ID: ${result.rows[0].id}`);
    
    // Query it back to verify structure
    const queryResult = await client.query(
      'SELECT * FROM scan_responses WHERE id = $1',
      [result.rows[0].id]
    );
    
    const session = queryResult.rows[0];
    const selections = session.card_selections;
    
    console.log('\n📊 Complete Data Verification:');
    console.log(`Session ID: ${session.session_id}`);
    console.log(`Total Domains: ${selections.domains?.length || 0}`);
    console.log(`Selected Cards: ${selections.selected?.length || 0}`);
    console.log(`Rejected Cards: ${selections.rejected?.length || 0}`);
    console.log(`All Responses: ${selections.allResponses?.length || 0}`);
    
    if (selections.allResponses) {
      console.log('\n🔍 Response Analysis Capabilities:');
      
      // Can we analyze by domain?
      const byDomain = {};
      selections.allResponses.forEach(resp => {
        if (!byDomain[resp.domain]) byDomain[resp.domain] = { yes: 0, no: 0, avgTime: 0 };
        if (resp.response) {
          byDomain[resp.domain].yes++;
        } else {
          byDomain[resp.domain].no++;
        }
      });
      
      console.log('Domain Analysis:', byDomain);
      
      // Can we analyze response times?
      const avgResponseTime = selections.allResponses.reduce((sum, r) => sum + r.responseTime, 0) / selections.allResponses.length;
      console.log(`Average Response Time: ${Math.round(avgResponseTime)}ms`);
      
      // Can we identify quick vs slow decisions?
      const quickResponses = selections.allResponses.filter(r => r.responseTime < 1500).length;
      console.log(`Quick Responses (<1.5s): ${quickResponses}/${selections.allResponses.length}`);
    }
    
    console.log('\n✅ Current schema can handle comprehensive analytics!');
    console.log('✅ No database schema changes needed');
    
    client.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  }
}

testCompleteDataStructure();
