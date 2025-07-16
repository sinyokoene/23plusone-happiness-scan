# Supabase Row Level Security (RLS) Setup

## Overview
This document explains how to secure your `scan_responses` table with Row Level Security policies to address the Supabase Security Advisor warning.

## What RLS Does
Row Level Security (RLS) controls which rows users can access in your database tables. Without RLS enabled, anyone with database access can read, insert, update, or delete any data.

## Our Security Model

### 🔒 Policies Applied

1. **Public INSERT Policy** (`Allow public inserts`)
   - Allows anonymous users to submit scan responses
   - Essential for the happiness scan to work
   - No authentication required for taking the scan

2. **Public READ Policy** (`Allow public reads`) 
   - Allows reading scan data for benchmarking
   - Enables the "How You Compare" feature
   - No sensitive personal data is exposed

3. **No UPDATE/DELETE Policies**
   - Prevents modification of existing scan data
   - Ensures data integrity and audit trail
   - Once submitted, scan responses cannot be changed

### 🛡️ Additional Security Layers

1. **Analytics View** (`public_scan_analytics`)
   - Safe public access to aggregate data
   - Only shows last 30 days of data
   - Excludes sensitive fields like session_id

2. **Benchmark Function** (`get_benchmark_stats`)
   - Secure way to calculate percentiles
   - Doesn't expose raw individual data
   - Uses SECURITY DEFINER for controlled access

## How to Apply These Policies

### Option 1: Supabase Dashboard (Recommended)
1. Go to your [Supabase project dashboard](https://app.supabase.com)
2. Navigate to **SQL Editor**
3. Copy the contents of `db/rls-policies.sql`
4. Paste into the SQL editor
5. Click **Run** to execute

### Option 2: Command Line
```bash
# Install psql if needed (macOS)
brew install postgresql

# Connect to your Supabase database
psql 'postgresql://postgres:[YOUR_PASSWORD]@[YOUR_HOST]:5432/postgres'

# Run the policies file
\i db/rls-policies.sql
```

### Option 3: Automated Script
```bash
# Set your database URL
export SUPABASE_DATABASE_URL='postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres'

# Run the script
./apply-rls-policies.sh
```

## Verifying the Setup

After applying the policies, you can verify they're working:

1. **Check RLS is enabled:**
   ```sql
   SELECT tablename, rowsecurity 
   FROM pg_tables 
   WHERE tablename = 'scan_responses';
   ```

2. **List active policies:**
   ```sql
   SELECT policyname, permissive, roles, cmd, qual 
   FROM pg_policies 
   WHERE tablename = 'scan_responses';
   ```

3. **Test the benchmark function:**
   ```sql
   SELECT get_benchmark_stats(75.5);
   ```

## Impact on Your Application

✅ **Will Continue Working:**
- Happiness scan submissions
- Results display
- Benchmarking ("How You Compare")
- All existing functionality

❌ **Will Be Blocked:**
- Direct database modifications
- Unauthorized data access
- Bulk data exports (unless authorized)

## Security Benefits

1. **Data Integrity**: Scan responses cannot be modified after submission
2. **Privacy Protection**: No direct access to sensitive session data
3. **Controlled Analytics**: Only approved aggregate data is accessible
4. **Audit Trail**: All data changes are logged and traceable
5. **Compliance Ready**: Meets security best practices for data handling

## Troubleshooting

If you encounter issues after applying RLS:

1. **Scan submissions failing**: Check that the INSERT policy is active
2. **Benchmarking not working**: Verify the READ policy and benchmark function
3. **Analytics broken**: Ensure the analytics view has proper permissions

## Monitoring

You can monitor security with these queries:

```sql
-- Check recent scan submissions
SELECT COUNT(*) as recent_scans 
FROM scan_responses 
WHERE timestamp >= NOW() - INTERVAL '1 day';

-- Monitor policy usage
SELECT schemaname, tablename, policyname, permissive 
FROM pg_policies 
WHERE tablename = 'scan_responses';
```

## Need Help?

- Supabase RLS Documentation: https://supabase.com/docs/guides/auth/row-level-security
- PostgreSQL RLS Guide: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Your project's Security Advisor in the Supabase dashboard
