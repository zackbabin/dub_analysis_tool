-- Migration: Materialize premium_creator_affinity_display as a table
-- Created: 2025-12-03
-- Purpose: Fix statement timeout by pre-computing expensive affinity view
--
-- Problem: premium_creator_affinity_display view times out on frontend (57014 error)
--          View performs expensive JOINs on user_portfolio_creator_engagement
-- Solution: Convert to materialized table, refresh via Edge Function

-- Drop the existing view or table (handle both cases)
DROP VIEW IF EXISTS premium_creator_affinity_display CASCADE;
DROP TABLE IF EXISTS premium_creator_affinity_display CASCADE;

-- Create materialized table
CREATE TABLE premium_creator_affinity_display (
  premium_creator TEXT PRIMARY KEY,
  premium_creator_total_copies BIGINT NOT NULL DEFAULT 0,
  premium_creator_total_liquidations BIGINT NOT NULL DEFAULT 0,
  top_1 TEXT,
  top_2 TEXT,
  top_3 TEXT,
  top_4 TEXT,
  top_5 TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_premium_creator_affinity_copies ON premium_creator_affinity_display(premium_creator_total_copies DESC);

COMMENT ON TABLE premium_creator_affinity_display IS
'Materialized premium creator copy affinity data. Refreshed by refresh_premium_creator_affinity() function.
Shows top 5 co-copied creators for each premium creator.';

GRANT SELECT ON premium_creator_affinity_display TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON premium_creator_affinity_display TO service_role;

-- Create refresh function
CREATE OR REPLACE FUNCTION refresh_premium_creator_affinity()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Truncate and repopulate table
  TRUNCATE premium_creator_affinity_display;

  INSERT INTO premium_creator_affinity_display (
    premium_creator,
    premium_creator_total_copies,
    premium_creator_total_liquidations,
    top_1,
    top_2,
    top_3,
    top_4,
    top_5,
    updated_at
  )
  WITH premium_totals_direct AS (
    -- Get totals directly using same logic as premium_creator_breakdown
    SELECT
      pc.creator_username AS premium_creator,
      COALESCE(SUM(pccm.total_copies), 0)::bigint AS premium_creator_total_copies,
      COALESCE(SUM(pccm.total_liquidations), 0)::bigint AS premium_creator_total_liquidations
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_copy_metrics pccm
      ON pc.creator_id = pccm.creator_id
    GROUP BY pc.creator_username
  ),
  all_premium_creators AS (
    -- Get ALL premium creators with their totals
    SELECT
      creator_username AS premium_creator,
      COALESCE(pt.premium_creator_total_copies, 0)::bigint AS premium_creator_total_copies,
      COALESCE(pt.premium_creator_total_liquidations, 0)::bigint AS premium_creator_total_liquidations
    FROM (SELECT DISTINCT creator_username FROM premium_creators) pc
    LEFT JOIN premium_totals_direct pt ON pc.creator_username = pt.premium_creator
  ),
  ranked_regular AS (
    SELECT
      premium_creator,
      copied_creator,
      total_copies,
      unique_copiers,
      ROW_NUMBER() OVER (
        PARTITION BY premium_creator
        ORDER BY unique_copiers DESC, total_copies DESC
      ) AS rank
    FROM premium_creator_copy_affinity_base
    WHERE copy_type = 'Regular'
  ),
  ranked_premium AS (
    SELECT
      premium_creator,
      copied_creator,
      total_copies,
      unique_copiers,
      ROW_NUMBER() OVER (
        PARTITION BY premium_creator
        ORDER BY unique_copiers DESC, total_copies DESC
      ) AS rank
    FROM premium_creator_copy_affinity_base
    WHERE copy_type = 'Premium'
  )
  SELECT
    apc.premium_creator,
    apc.premium_creator_total_copies,
    apc.premium_creator_total_liquidations,
    -- Top 1: Regular and Premium combined
    MAX(CASE WHEN rr.rank = 1 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
      CASE WHEN MAX(CASE WHEN rp.rank = 1 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
      MAX(CASE WHEN rp.rank = 1 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_1,
    -- Top 2: Regular and Premium combined
    MAX(CASE WHEN rr.rank = 2 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
      CASE WHEN MAX(CASE WHEN rp.rank = 2 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
      MAX(CASE WHEN rp.rank = 2 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_2,
    -- Top 3: Regular and Premium combined
    MAX(CASE WHEN rr.rank = 3 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
      CASE WHEN MAX(CASE WHEN rp.rank = 3 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
      MAX(CASE WHEN rp.rank = 3 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_3,
    -- Top 4: Regular and Premium combined
    MAX(CASE WHEN rr.rank = 4 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
      CASE WHEN MAX(CASE WHEN rp.rank = 4 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
      MAX(CASE WHEN rp.rank = 4 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_4,
    -- Top 5: Regular and Premium combined
    MAX(CASE WHEN rr.rank = 5 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
      CASE WHEN MAX(CASE WHEN rp.rank = 5 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
      MAX(CASE WHEN rp.rank = 5 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_5,
    NOW() as updated_at
  FROM all_premium_creators apc
  LEFT JOIN ranked_regular rr
    ON apc.premium_creator = rr.premium_creator AND rr.rank <= 5
  LEFT JOIN ranked_premium rp
    ON apc.premium_creator = rp.premium_creator AND rp.rank <= 5
  GROUP BY
    apc.premium_creator,
    apc.premium_creator_total_copies,
    apc.premium_creator_total_liquidations
  ORDER BY apc.premium_creator_total_copies DESC NULLS LAST, apc.premium_creator;
END;
$$;

COMMENT ON FUNCTION refresh_premium_creator_affinity IS
'Refreshes premium_creator_affinity_display table with latest affinity data.
Called by sync-creator-data edge function after data sync.';

-- Initial population
SELECT refresh_premium_creator_affinity();

-- Update refresh_all_materialized_views() to include this table
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS TEXT AS $$
DECLARE
  start_time TIMESTAMP;
  end_time TIMESTAMP;
  duration INTERVAL;
  result_text TEXT;
BEGIN
  start_time := clock_timestamp();

  RAISE NOTICE '';
  RAISE NOTICE '=== Starting Materialized View Refresh ===';
  RAISE NOTICE 'Time: %', start_time;
  RAISE NOTICE '';

  -- LEVEL 1: Base materialized views (no dependencies on other mat views)
  -- These can technically run in parallel but we do them sequentially for simplicity

  RAISE NOTICE '→ Level 1: Refreshing base materialized views...';

  -- 1. main_analysis (subscribers_insights + user_portfolio_creator_engagement)
  RAISE NOTICE '  → Refreshing main_analysis...';
  REFRESH MATERIALIZED VIEW main_analysis;
  RAISE NOTICE '  ✓ main_analysis refreshed';

  -- 2. portfolio_creator_engagement_metrics (user_portfolio_creator_engagement)
  RAISE NOTICE '  → Refreshing portfolio_creator_engagement_metrics...';
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
  RAISE NOTICE '  ✓ portfolio_creator_engagement_metrics refreshed';

  -- 3. enriched_support_conversations (raw_support_conversations + subscribers_insights)
  RAISE NOTICE '  → Refreshing enriched_support_conversations...';
  -- Try concurrent first (has unique index), fall back to regular if needed
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY enriched_support_conversations;
    RAISE NOTICE '  ✓ enriched_support_conversations refreshed (CONCURRENT)';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '  ⚠ Concurrent refresh failed, using regular refresh';
      REFRESH MATERIALIZED VIEW enriched_support_conversations;
      RAISE NOTICE '  ✓ enriched_support_conversations refreshed (REGULAR)';
  END;

  -- 4. premium_creator_affinity_display (materialized table)
  RAISE NOTICE '  → Refreshing premium_creator_affinity_display...';
  PERFORM refresh_premium_creator_affinity();
  RAISE NOTICE '  ✓ premium_creator_affinity_display refreshed';

  RAISE NOTICE '';
  RAISE NOTICE '→ Level 2+: All other views are regular views and auto-update';
  RAISE NOTICE '  ✓ copy_engagement_summary (regular view, auto-updated)';
  RAISE NOTICE '  ✓ subscription_engagement_summary (regular view, auto-updated)';
  RAISE NOTICE '  ✓ hidden_gems_portfolios (regular view, auto-updated)';
  RAISE NOTICE '  ✓ premium_creator_breakdown (regular view, auto-updated)';
  RAISE NOTICE '  ✓ All other dependent views (auto-updated)';

  end_time := clock_timestamp();
  duration := end_time - start_time;

  RAISE NOTICE '';
  RAISE NOTICE '=== Materialized View Refresh Complete ===';
  RAISE NOTICE 'Duration: %', duration;
  RAISE NOTICE 'Refreshed: 3 materialized views + 1 materialized table';
  RAISE NOTICE 'Auto-updated: All regular views';
  RAISE NOTICE '';

  result_text := format('Successfully refreshed 3 materialized views + 1 table in %s', duration);
  RETURN result_text;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '';
    RAISE NOTICE '❌ ERROR during materialized view refresh';
    RAISE NOTICE 'Error: %', SQLERRM;
    RAISE NOTICE 'Detail: %', SQLSTATE;
    RAISE NOTICE '';
    RAISE EXCEPTION 'Materialized view refresh failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_all_materialized_views() IS
'Centralized function to refresh all materialized views in correct dependency order.
Refreshes 3 base materialized views + 1 materialized table:
1. main_analysis
2. portfolio_creator_engagement_metrics
3. enriched_support_conversations
4. premium_creator_affinity_display (table)

All other views are regular views that auto-update.
Called by edge functions after data sync operations.';

-- =======================
-- Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Materialized premium_creator_affinity_display';
  RAISE NOTICE '   - Converted view to table for performance';
  RAISE NOTICE '   - Created refresh_premium_creator_affinity() function';
  RAISE NOTICE '   - Eliminates statement timeout on frontend';
  RAISE NOTICE '   - Added to refresh_all_materialized_views() function';
  RAISE NOTICE '';
END $$;
