const { Pool } = require('pg');

// Database connection pool with robust env detection
function resolveDatabaseUrl() {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.SUPABASE_DB_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRESQL_URL,
    process.env.DB_URL
  ];
  for (const url of candidates) {
    if (url && typeof url === 'string' && url.trim().length > 0) return url.trim();
  }
  return 'postgresql://sinyo@localhost:5432/happiness_benchmark';
}

const resolvedDbUrl = resolveDatabaseUrl();
const isSupabase = /supabase\.co|supabase\.in/i.test(resolvedDbUrl);

const pool = new Pool({
  connectionString: resolvedDbUrl,
  ssl: (process.env.NODE_ENV === 'production' || isSupabase) ? { rejectUnauthorized: false } : false
});

// Optional separate research DB (falls back to main if not provided)
const researchDbUrl = process.env.RESEARCH_DATABASE_URL || resolvedDbUrl;
const researchPool = new Pool({
  connectionString: researchDbUrl,
  ssl: (process.env.NODE_ENV === 'production' || /supabase\.co|supabase\.in/i.test(researchDbUrl)) ? { rejectUnauthorized: false } : false
});

console.log('🔌 DB URL source resolved:', resolvedDbUrl ? 'set' : 'missing');

module.exports = {
  pool,
  researchPool,
  resolveDatabaseUrl,
  resolvedDbUrl
};
