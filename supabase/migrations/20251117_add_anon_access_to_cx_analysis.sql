-- Add anonymous user read access to support_analysis_results
-- Allows frontend to display CX Analysis results without authentication

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Anonymous users can view support_analysis_results" ON support_analysis_results;

-- Create policy for anonymous read access
CREATE POLICY "Anonymous users can view support_analysis_results"
  ON support_analysis_results
  FOR SELECT
  TO anon
  USING (true);

-- Verify the change
DO $$
BEGIN
  RAISE NOTICE 'Added anonymous read access to support_analysis_results table';
END $$;
