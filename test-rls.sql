-- Test RLS Policies Implementation

-- 1. Verify RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'scan_responses';
-- Expected: rowsecurity = true

-- 2. List all policies on the table
SELECT policyname, permissive, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'scan_responses';
-- Expected: Should show "Allow public inserts" and "Allow public reads"

-- 3. Test INSERT permission (should work)
INSERT INTO scan_responses (
    session_id, 
    card_selections, 
    ihs_score, 
    n1_score, 
    n2_score, 
    n3_score, 
    completion_time
) VALUES (
    'test-rls-' || extract(epoch from now()), 
    '{"selected": [1, 5, 12], "domains": ["test"]}',
    85.5,
    80.0,
    85.0,
    90.0,
    120
);
-- Expected: Success

-- 4. Test SELECT permission (should work)
SELECT COUNT(*) as total_scans, 
       AVG(ihs_score) as avg_score,
       MAX(created_at) as latest_scan
FROM scan_responses;
-- Expected: Should return data

-- 5. Test the analytics view
SELECT * FROM public_scan_analytics LIMIT 5;
-- Expected: Should show anonymized data

-- 6. Test the benchmark function
SELECT get_benchmark_stats(85.5);
-- Expected: Should return JSON with percentile info

-- 7. Test UPDATE permission (should fail)
UPDATE scan_responses 
SET ihs_score = 100.0 
WHERE session_id LIKE 'test-rls-%';
-- Expected: Policy violation error

-- 8. Test DELETE permission (should fail)  
DELETE FROM scan_responses 
WHERE session_id LIKE 'test-rls-%';
-- Expected: Policy violation error

-- Clean up test data (this should also fail due to RLS)
-- DELETE FROM scan_responses WHERE session_id LIKE 'test-rls-%';
