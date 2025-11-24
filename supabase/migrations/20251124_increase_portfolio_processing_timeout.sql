-- Increase statement timeout for portfolio engagement processing
-- The function processes 60-70k records with GROUP BY and can exceed default 60s timeout
-- Date: 2024-11-24

-- Set function to use 5 minute timeout instead of default 60s
ALTER FUNCTION process_portfolio_engagement_staging() SET statement_timeout = '300s';

COMMENT ON FUNCTION process_portfolio_engagement_staging IS
  'Processes portfolio engagement staging data with GROUP BY deduplication. Uses 5min timeout for large batches (60-70k records).';
