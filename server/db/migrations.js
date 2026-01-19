async function dropIpAddressColumnIfExists(pool) {
  try {
    const client = await pool.connect();
    try {
      await client.query('ALTER TABLE scan_responses DROP COLUMN IF EXISTS ip_address');
      console.log('🧹 Dropped ip_address column if it existed');
    } finally {
      client.release();
    }
  } catch (e) {
    console.warn('Startup migration: could not drop ip_address column', e?.message || e);
  }
}

async function ensureN1ScaledColumns(pool) {
  try {
    const client = await pool.connect();
    try {
      await client.query('ALTER TABLE scan_responses ADD COLUMN IF NOT EXISTS n1_scaled_100 REAL');
      await client.query('ALTER TABLE scan_responses ADD COLUMN IF NOT EXISTS n1_trials_total INTEGER');
      await client.query('ALTER TABLE scan_responses ADD COLUMN IF NOT EXISTS n1_version SMALLINT NOT NULL DEFAULT 2');
      console.log('🧩 Ensured N1 scaled columns exist');
    } finally {
      client.release();
    }
  } catch (e) {
    console.warn('Startup migration: ensureN1ScaledColumns failed', e?.message || e);
  }
}

async function runStartupMigrations(pool) {
  await dropIpAddressColumnIfExists(pool);
  await ensureN1ScaledColumns(pool);
}

module.exports = {
  runStartupMigrations,
  dropIpAddressColumnIfExists,
  ensureN1ScaledColumns
};
