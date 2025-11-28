-- Migration: Verify and recreate all critical views needed by frontend
-- Created: 2025-11-27
-- Purpose: Ensure all views queried by frontend exist

-- Critical materialized views that should exist:
-- 1. hidden_gems_portfolios (already exists from base schema)
-- 2. copy_engagement_summary (should exist)
-- 3. main_analysis (should exist)

-- Let's verify and recreate any missing regular views

-- 1. Verify portfolio_creator_engagement_metrics exists (required for hidden_gems)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'portfolio_creator_engagement_metrics') THEN
        RAISE NOTICE '';
        RAISE NOTICE '❌❌❌ CRITICAL: portfolio_creator_engagement_metrics materialized view is MISSING ❌❌❌';
        RAISE NOTICE '   This is the source for hidden_gems_portfolios and other views';
        RAISE NOTICE '   It should be created by the base schema migration';
        RAISE NOTICE '   Required columns: portfolio_ticker, creator_id, creator_username, unique_viewers,';
        RAISE NOTICE '                     total_pdp_views, total_copies, total_liquidations, conversion_rate_pct';
        RAISE NOTICE '';
    ELSE
        RAISE NOTICE '✓ portfolio_creator_engagement_metrics materialized view exists';
    END IF;
END $$;

-- 2. Verify hidden_gems_portfolios exists (materialized view)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'hidden_gems_portfolios') THEN
        RAISE NOTICE '';
        RAISE NOTICE '❌ hidden_gems_portfolios materialized view is MISSING - recreating...';

        -- Recreate it (exact match to original schema + alias for frontend compatibility)
        CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
        SELECT
            portfolio_ticker,
            creator_id,
            creator_username,
            unique_viewers,
            total_pdp_views,
            total_copies,
            total_liquidations,
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

        RAISE NOTICE '✅ Created hidden_gems_portfolios materialized view';
        RAISE NOTICE '   To populate: Call refresh_portfolio_engagement_views() or sync creator data';
        RAISE NOTICE '';
    ELSE
        RAISE NOTICE '✓ hidden_gems_portfolios materialized view exists';
    END IF;
END $$;

-- 3. Verify refresh function exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_portfolio_engagement_views') THEN
        RAISE NOTICE '';
        RAISE NOTICE '❌ refresh_portfolio_engagement_views() function is MISSING';
        RAISE NOTICE '   This function is needed to populate materialized views';
        RAISE NOTICE '';
    ELSE
        RAISE NOTICE '✓ refresh_portfolio_engagement_views() function exists';
    END IF;
END $$;

-- Summary
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '===============================================';
    RAISE NOTICE 'View verification complete!';
    RAISE NOTICE 'Check the notices above for any missing views.';
    RAISE NOTICE '===============================================';
END $$;
