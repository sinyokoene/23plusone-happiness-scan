// Test script for 23plusone Happiness Scan scoring algorithm
// Run with: node test-scoring.js

console.log('🧪 Testing 23plusone Happiness Scan Scoring Algorithm');
console.log('================================================');

// Mock responses for testing
const testResponses = [
  { id: 1, domain: 'Basics', yes: true, time: 800 },
  { id: 2, domain: 'Basics', yes: false, time: 3200 },
  { id: 3, domain: 'Ambition', yes: true, time: 1500 },
  { id: 4, domain: 'Ambition', yes: true, time: 2100 },
  { id: 5, domain: 'Self-development', yes: true, time: 900 },
  { id: 6, domain: 'Self-development', yes: false, time: 3800 },
  { id: 7, domain: 'Vitality', yes: true, time: 1200 },
  { id: 8, domain: 'Vitality', yes: true, time: 2800 },
  { id: 9, domain: 'Attraction', yes: false, time: 2000 },
  { id: 10, domain: 'Attraction', yes: true, time: 1100 }
];

function getTimeMultiplier(time) {
  if (time <= 1000) return 1.0;
  if (time <= 2000) return 0.8;
  if (time <= 3000) return 0.6;
  return 0.4;
}

function calculateIHS(answers) {
  console.log('\n📊 Calculating IHS for', answers.length, 'responses...');
  
  // N1: Affirmations + Time
  const yesResponses = answers.filter(a => a.yes);
  console.log('\n1️⃣ N1: Affirmations + Time');
  console.log('Yes responses:', yesResponses.length);
  
  let n1 = 0;
  yesResponses.forEach(a => {
    const multiplier = getTimeMultiplier(a.time);
    const score = 4 * multiplier;
    n1 += score;
    console.log(`   ${a.domain}: ${a.time}ms → ×${multiplier} → +${score.toFixed(1)}`);
  });
  
  console.log(`   Total N1: ${n1.toFixed(1)}`);
  
  // N2: Domain Coverage
  console.log('\n2️⃣ N2: Domain Coverage');
  const uniqueDomains = new Set(yesResponses.map(a => a.domain));
  const n2 = uniqueDomains.size * 19.2;
  
  console.log('Domains with Yes responses:', Array.from(uniqueDomains));
  console.log(`   Unique domains: ${uniqueDomains.size}`);
  console.log(`   N2: ${uniqueDomains.size} × 19.2 = ${n2.toFixed(1)}`);
  
  // N3: Spread Score
  console.log('\n3️⃣ N3: Spread Score');
  const domainCounts = {};
  const totalAnswers = answers.length;
  
  yesResponses.forEach(a => {
    domainCounts[a.domain] = (domainCounts[a.domain] || 0) + 1;
  });
  
  console.log('Domain counts:', domainCounts);
  
  const domainPercentages = Object.values(domainCounts).map(count => count / totalAnswers);
  console.log('Domain percentages:', domainPercentages.map(p => (p * 100).toFixed(1) + '%'));
  
  const spreadDeviation = domainPercentages.reduce((sum, pct) => {
    const deviation = Math.abs(pct - 0.2);
    console.log(`   |${(pct * 100).toFixed(1)}% - 20%| = ${(deviation * 100).toFixed(1)}%`);
    return sum + deviation;
  }, 0);
  
  const n3 = ((1.6 - spreadDeviation) / 1.6) * 100;
  console.log(`   Spread deviation: ${spreadDeviation.toFixed(3)}`);
  console.log(`   N3: ((1.6 - ${spreadDeviation.toFixed(3)}) / 1.6) × 100 = ${n3.toFixed(1)}`);
  
  // Final IHS
  console.log('\n🎯 Final IHS Calculation');
  const ihs = (0.4 * n1) + (0.4 * n2) + (0.2 * Math.max(0, n3));
  
  console.log(`   IHS = 0.4×${n1.toFixed(1)} + 0.4×${n2.toFixed(1)} + 0.2×${Math.max(0, n3).toFixed(1)}`);
  console.log(`   IHS = ${(0.4 * n1).toFixed(1)} + ${(0.4 * n2).toFixed(1)} + ${(0.2 * Math.max(0, n3)).toFixed(1)}`);
  console.log(`   IHS = ${ihs.toFixed(1)}`);
  
  return {
    ihs: Math.round(ihs * 10) / 10,
    n1: Math.round(n1 * 10) / 10,
    n2: Math.round(n2 * 10) / 10,
    n3: Math.round(n3 * 10) / 10,
    domainCounts,
    breakdown: {
      affirmations: Math.round((0.4 * n1) * 10) / 10,
      coverage: Math.round((0.4 * n2) * 10) / 10,
      spread: Math.round((0.2 * Math.max(0, n3)) * 10) / 10
    }
  };
}

// Run the test
const result = calculateIHS(testResponses);

console.log('\n✅ Test Results Summary');
console.log('======================');
console.log('Final IHS:', result.ihs);
console.log('Component scores:');
console.log('  • Affirmations+Time (40%):', result.breakdown.affirmations);
console.log('  • Domain Coverage (40%):', result.breakdown.coverage);
console.log('  • Spread Balance (20%):', result.breakdown.spread);
console.log('\nDomain breakdown:');
Object.entries(result.domainCounts).forEach(([domain, count]) => {
  console.log(`  • ${domain}: ${count} Yes`);
});

console.log('\n🎉 Scoring algorithm test completed!');
