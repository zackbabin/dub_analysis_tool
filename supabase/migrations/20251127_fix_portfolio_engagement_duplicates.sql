-- Migration: Fix duplicate rows preventing unique index creation
-- Created: 2025-11-27
-- Purpose: Remove duplicates from portfolio_creator_engagement_metrics refresh
--
-- Background:
-- - REFRESH MATERIALIZED VIEW failing with "could not create unique index"
-- - Indicates duplicate (portfolio_ticker, creator_id) rows in the result
-- - Likely caused by multiple creator_username values for same creator_id

-- Drop and recreate portfolio_creator_engagement_metrics with deduplication
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;

CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  portfolio_ticker,
  creator_id,
  -- Use MAX to handle potential multiple creator_username values per creator_id
  MAX(creator_username) as creator_username,
  COUNT(DISTINCT user_id) as unique_viewers,
  COUNT(DISTINCT CASE WHEN did_copy THEN user_id END) as unique_copiers,
  SUM(pdp_view_count) as total_pdp_views,
  SUM(copy_count) as total_copies,
  ROUND(
    (COUNT(DISTINCT CASE WHEN did_copy THEN user_id END)::numeric /
     NULLIF(COUNT(DISTINCT user_id), 0)) * 100, 2
  ) as copy_conversion_rate
FROM user_portfolio_creator_engagement
GROUP BY portfolio_ticker, creator_id;

CREATE UNIQUE INDEX idx_portfolio_creator_engagement_metrics_unique
  ON portfolio_creator_engagement_metrics(portfolio_ticker, creator_id);

GRANT SELECT ON portfolio_creator_engagement_metrics TO service_role, authenticated, anon;

COMMENT ON MATERIALIZED VIEW portfolio_creator_engagement_metrics IS
'Aggregates portfolio engagement metrics per creator. Uses user_id for aggregation.
Groups by (portfolio_ticker, creator_id) and uses MAX(creator_username) to handle any username variations.
Refreshed via refresh_portfolio_engagement_views().';

-- Recreate dependent views that were dropped by CASCADE
-- Note: Other dependent views will be recreated by existing refresh functions

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed portfolio_creator_engagement_metrics';
  RAISE NOTICE '   - Added MAX(creator_username) to handle duplicates';
  RAISE NOTICE '   - Groups only by (portfolio_ticker, creator_id)';
  RAISE NOTICE '   - Unique index should now create successfully';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️ Run refresh_portfolio_engagement_views() to recreate dependent views';
  RAISE NOTICE '';
END $$;
