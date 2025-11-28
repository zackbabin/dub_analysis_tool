-- Migration: Recreate hidden_gems_portfolios materialized view
-- Created: 2025-11-27
-- Purpose: Ensure hidden_gems_portfolios view exists with correct schema

-- Drop and recreate hidden_gems_portfolios materialized view
DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;

CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
SELECT
    portfolio_ticker,
    creator_id,
    creator_username,
    unique_viewers,
    total_pdp_views,
    total_copies,
    conversion_rate_pct,
    conversion_rate_pct AS copy_conversion_rate,  -- Alias for frontend compatibility
    CASE
        WHEN total_copies > 0 THEN ROUND((unique_viewers::NUMERIC / total_copies::NUMERIC), 2)
        ELSE NULL::NUMERIC
    END AS viewer_copier_ratio
FROM portfolio_creator_engagement_metrics
WHERE unique_viewers >= 5
    AND total_copies < 5
    AND unique_viewers >= (total_copies * 5)
ORDER BY unique_viewers DESC,
    CASE
        WHEN total_copies > 0 THEN ROUND((unique_viewers::NUMERIC / total_copies::NUMERIC), 2)
        ELSE NULL::NUMERIC
    END DESC
WITH NO DATA;

GRANT SELECT ON hidden_gems_portfolios TO anon, authenticated, service_role;

COMMENT ON MATERIALIZED VIEW hidden_gems_portfolios IS
'Hidden gem portfolios: many unique viewers but few unique copiers (ratio >= 5). Indicates high interest but low conversion. Refreshed via refresh_portfolio_engagement_views().';

-- Verify the view was created
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'hidden_gems_portfolios') THEN
        RAISE NOTICE '';
        RAISE NOTICE '✅ hidden_gems_portfolios materialized view created successfully';
        RAISE NOTICE '   Columns: portfolio_ticker, creator_id, creator_username, unique_viewers,';
        RAISE NOTICE '            total_pdp_views, total_copies, conversion_rate_pct,';
        RAISE NOTICE '            copy_conversion_rate, viewer_copier_ratio';
        RAISE NOTICE '';
        RAISE NOTICE '⚠️  View is empty (WITH NO DATA) - populate by calling:';
        RAISE NOTICE '    SELECT refresh_portfolio_engagement_views();';
        RAISE NOTICE '';
    ELSE
        RAISE EXCEPTION 'Failed to create hidden_gems_portfolios view';
    END IF;
END $$;
