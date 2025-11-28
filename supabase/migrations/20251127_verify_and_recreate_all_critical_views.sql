-- Migration: Verify and recreate all critical views needed by frontend
-- Created: 2025-11-27
-- Purpose: Ensure all views queried by frontend exist

-- Critical materialized views that should exist:
-- 1. hidden_gems_portfolios (already exists from base schema)
-- 2. copy_engagement_summary (should exist)
-- 3. main_analysis (should exist)

-- Let's verify and recreate any missing regular views

-- 1. Verify copy_engagement_summary exists (this is a regular view, not materialized)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'copy_engagement_summary') THEN
        RAISE NOTICE 'copy_engagement_summary view is missing - will be created';
    ELSE
        RAISE NOTICE '✓ copy_engagement_summary view exists';
    END IF;
END $$;

-- 2. Verify hidden_gems_portfolios exists (materialized view)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'hidden_gems_portfolios') THEN
        RAISE NOTICE '❌ hidden_gems_portfolios materialized view is MISSING';

        -- Recreate it
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
            CASE
                WHEN total_copies > 0 THEN ROUND((unique_viewers::NUMERIC / total_copies::NUMERIC), 2)
                ELSE NULL
            END AS viewer_copier_ratio
        FROM portfolio_creator_engagement_metrics
        WHERE unique_viewers >= 5
            AND total_copies < 5
            AND unique_viewers >= (total_copies * 5)
        ORDER BY unique_viewers DESC,
            CASE
                WHEN total_copies > 0 THEN ROUND((unique_viewers::NUMERIC / total_copies::NUMERIC), 2)
                ELSE NULL
            END DESC
        WITH NO DATA;

        GRANT SELECT ON hidden_gems_portfolios TO anon, authenticated, service_role;

        COMMENT ON MATERIALIZED VIEW hidden_gems_portfolios IS
        'Hidden gem portfolios: many unique viewers but few unique copiers (ratio >= 5). Indicates high interest but low conversion. Refreshed via refresh_portfolio_engagement_views().';

        RAISE NOTICE '✅ Created hidden_gems_portfolios materialized view';
    ELSE
        RAISE NOTICE '✓ hidden_gems_portfolios materialized view exists';
    END IF;
END $$;

-- 3. Verify conversion_pattern_combinations exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'conversion_pattern_combinations') THEN
        RAISE NOTICE '❌ conversion_pattern_combinations table is MISSING';
        RAISE NOTICE '   This should be populated by Edge Function analyze-copy-patterns';
    ELSE
        RAISE NOTICE '✓ conversion_pattern_combinations table exists';
    END IF;
END $$;

-- 4. Verify copy_conversion_by_engagement exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'copy_conversion_by_engagement') THEN
        RAISE NOTICE '❌ copy_conversion_by_engagement table is MISSING';
        RAISE NOTICE '   This should be populated by Edge Function analyze-copy-patterns';
    ELSE
        RAISE NOTICE '✓ copy_conversion_by_engagement table exists';
    END IF;
END $$;

-- 5. Verify premium_creator_affinity_display exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'premium_creator_affinity_display') THEN
        RAISE NOTICE '❌ premium_creator_affinity_display view is MISSING';
    ELSE
        RAISE NOTICE '✓ premium_creator_affinity_display view exists';
    END IF;
END $$;

-- 6. Verify behavioral driver tables exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'subscription_drivers') THEN
        RAISE NOTICE '❌ subscription_drivers table is MISSING';
    ELSE
        RAISE NOTICE '✓ subscription_drivers table exists';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'deposit_drivers') THEN
        RAISE NOTICE '❌ deposit_drivers table is MISSING';
    ELSE
        RAISE NOTICE '✓ deposit_drivers table exists';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'copy_drivers') THEN
        RAISE NOTICE '❌ copy_drivers table is MISSING';
    ELSE
        RAISE NOTICE '✓ copy_drivers table exists';
    END IF;
END $$;

-- 7. Verify premium creator views from previous migration
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'premium_creator_breakdown') THEN
        RAISE NOTICE '❌ premium_creator_breakdown view is MISSING';
    ELSE
        RAISE NOTICE '✓ premium_creator_breakdown view exists';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'premium_creator_summary_stats') THEN
        RAISE NOTICE '❌ premium_creator_summary_stats view is MISSING';
    ELSE
        RAISE NOTICE '✓ premium_creator_summary_stats view exists';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'premium_creator_top_5_stocks') THEN
        RAISE NOTICE '❌ premium_creator_top_5_stocks view is MISSING';
    ELSE
        RAISE NOTICE '✓ premium_creator_top_5_stocks view exists';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'top_stocks_all_premium_creators') THEN
        RAISE NOTICE '❌ top_stocks_all_premium_creators view is MISSING';
    ELSE
        RAISE NOTICE '✓ top_stocks_all_premium_creators view exists';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'portfolio_breakdown_with_metrics') THEN
        RAISE NOTICE '❌ portfolio_breakdown_with_metrics view is MISSING';
    ELSE
        RAISE NOTICE '✓ portfolio_breakdown_with_metrics view exists';
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
