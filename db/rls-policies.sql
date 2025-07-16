-- Enable Row Level Security (RLS) on scan_responses table
ALTER TABLE scan_responses ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow anyone to INSERT new scan responses (for anonymous users taking the scan)
CREATE POLICY "Allow public inserts" ON scan_responses
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Policy 2: Allow reading scan responses for analytics/benchmarking (read-only public access)
CREATE POLICY "Allow public reads" ON scan_responses
  FOR SELECT
  TO public
  USING (true);

-- Policy 3: Prevent updates and deletes (data integrity protection)
-- No UPDATE or DELETE policies = no one can modify/delete existing data

-- Optional: If you want to restrict reads to only aggregate data, you could replace Policy 2 with:
-- CREATE POLICY "Allow aggregate reads only" ON scan_responses
--   FOR SELECT
--   TO public
--   USING (false); -- This would block direct reads, forcing use of stored procedures/functions

-- Create a view for public analytics that doesn't expose sensitive data
-- Using SECURITY INVOKER to respect user permissions and RLS policies
CREATE OR REPLACE VIEW public_scan_analytics 
WITH (security_invoker = true)
AS
SELECT 
  DATE_TRUNC('day', created_at) as scan_date,
  ihs_score,
  completion_time
FROM scan_responses
WHERE created_at >= NOW() - INTERVAL '30 days'; -- Only show last 30 days

-- Grant access to the view
GRANT SELECT ON public_scan_analytics TO public;

-- Create a secure function for benchmark calculations
-- Using explicit schema references and SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.get_benchmark_stats(user_ihs_score REAL)
RETURNS JSON 
LANGUAGE plpgsql 
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  total_responses INTEGER;
  avg_score REAL;
  percentile_rank REAL;
  result JSON;
BEGIN
  -- Get total responses in last 30 days
  SELECT COUNT(*) INTO total_responses 
  FROM public.scan_responses 
  WHERE created_at >= NOW() - INTERVAL '30 days';
  
  -- Get average score
  SELECT AVG(ihs_score) INTO avg_score 
  FROM public.scan_responses 
  WHERE created_at >= NOW() - INTERVAL '30 days';
  
  -- Calculate percentile rank
  SELECT (
    COUNT(*) * 100.0 / total_responses
  ) INTO percentile_rank
  FROM public.scan_responses 
  WHERE ihs_score <= user_ihs_score 
    AND created_at >= NOW() - INTERVAL '30 days';
  
  -- Build result
  result := json_build_object(
    'totalResponses', total_responses,
    'averageScore', ROUND(avg_score::numeric, 1),
    'userPercentile', ROUND(percentile_rank::numeric, 0)
  );
  
  RETURN result;
END;
$$;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION public.get_benchmark_stats(REAL) TO public;
