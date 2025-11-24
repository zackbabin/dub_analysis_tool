-- Increase statement timeout for engagement processing functions
-- Both functions process large batches (30-70k records) with GROUP BY and can exceed default 60s timeout
-- Date: 2024-11-24

-- Set portfolio engagement function to use 5 minute timeout instead of default 60s
ALTER FUNCTION process_portfolio_engagement_staging() SET statement_timeout = '300s';

COMMENT ON FUNCTION process_portfolio_engagement_staging IS
  'Processes portfolio engagement staging data with GROUP BY deduplication. Uses 5min timeout for large batches (60-70k records).';

-- Set creator engagement function to use 5 minute timeout as well (consistency)
ALTER FUNCTION process_creator_engagement_staging() SET statement_timeout = '300s';

COMMENT ON FUNCTION process_creator_engagement_staging IS
  'Processes creator engagement staging data with GROUP BY deduplication. Uses 5min timeout for large batches (30-40k records).';
