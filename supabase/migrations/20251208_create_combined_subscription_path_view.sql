-- Create view that combines creator and portfolio subscription paths
-- This allows frontend to query a single source instead of combining on client-side

CREATE OR REPLACE VIEW subscription_conversion_paths AS
SELECT
  analysis_type,
  path_rank,
  creator_sequence as sequence,
  'creator' as path_type,
  converter_count,
  pct_of_converters,
  total_converters_analyzed,
  updated_at,
  created_at
FROM creator_subscription_path_analysis
WHERE analysis_type IN ('creator_combinations', 'full_sequence')

UNION ALL

SELECT
  analysis_type,
  path_rank,
  portfolio_sequence as sequence,
  'portfolio' as path_type,
  converter_count,
  pct_of_converters,
  total_converters_analyzed,
  updated_at,
  created_at
FROM portfolio_subscription_path_analysis
WHERE analysis_type IN ('portfolio_combinations', 'full_sequence');

-- Grant access to view
GRANT SELECT ON subscription_conversion_paths TO anon, authenticated, service_role;

COMMENT ON VIEW subscription_conversion_paths IS
  'Combined view of creator and portfolio subscription conversion paths.
   Includes combinations and full sequences only (excludes first_creator/first_portfolio).
   Used by frontend to display unified subscription conversion path analysis.';

-- Verify
DO $$
BEGIN
  RAISE NOTICE '✅ Created subscription_conversion_paths view';
  RAISE NOTICE '   - Combines creator and portfolio paths into single queryable view';
  RAISE NOTICE '   - Frontend can now query one source instead of combining client-side';
END $$;
