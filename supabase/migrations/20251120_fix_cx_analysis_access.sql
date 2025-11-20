-- Migration: Fix CX Analysis anonymous access
-- Date: 2025-11-20
--
-- Ensures support_analysis_results table is accessible to anonymous users
-- This fixes the 546 error when loading the CX Analysis tab

-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "Service role has full access to support_analysis_results" ON support_analysis_results;
DROP POLICY IF EXISTS "Authenticated users can view support_analysis_results" ON support_analysis_results;
DROP POLICY IF EXISTS "Anonymous users can view support_analysis_results" ON support_analysis_results;

-- Recreate policies in correct order
CREATE POLICY "Service role has full access to support_analysis_results"
  ON support_analysis_results
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anonymous users can view support_analysis_results"
  ON support_analysis_results
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Authenticated users can view support_analysis_results"
  ON support_analysis_results
  FOR SELECT
  TO authenticated
  USING (true);

-- Verify RLS is enabled
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'support_analysis_results') THEN
    ALTER TABLE support_analysis_results ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'Enabled RLS on support_analysis_results';
  ELSE
    RAISE NOTICE 'RLS already enabled on support_analysis_results';
  END IF;
END $$;
