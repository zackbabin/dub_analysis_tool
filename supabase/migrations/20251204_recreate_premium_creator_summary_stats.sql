-- Migration: Recreate premium_creator_summary_stats view
-- Created: 2025-12-04
-- Purpose: Recreate view that was dropped by CASCADE in 20251203_fix_premium_creator_metrics_single_row.sql
--
-- Issue: 20251203_fix_premium_creator_metrics_single_row.sql dropped premium_creator_breakdown with CASCADE,
--        which also dropped premium_creator_summary_stats (dependent view), but never recreated it.
--
-- This view is queried by creator_analysis_tool_supabase.js for metric cards display.

CREATE VIEW premium_creator_summary_stats AS
SELECT
    -- Subscription CVR (avg and median)
    AVG(subscription_cvr) AS avg_subscription_cvr,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY subscription_cvr) AS median_subscription_cvr,

    -- Copies metrics (avg and median)
    AVG(total_copies) AS avg_copies,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copies) AS median_copies,

    -- All-Time Returns metrics (avg and median, excluding nulls)
    AVG(avg_all_time_returns) AS avg_all_time_returns,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_all_time_returns) AS median_all_time_returns,

    -- Copy Capital metrics (avg and median, excluding nulls)
    AVG(total_copy_capital) AS avg_copy_capital,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copy_capital) AS median_copy_capital,

    -- Include count of creators for reference
    COUNT(*) AS total_creators
FROM premium_creator_breakdown;

-- Grant permissions
GRANT SELECT ON premium_creator_summary_stats TO anon, authenticated;

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab. Calculates both averages and medians for Subscription CVR, Copies, All-Time Returns, and Copy Capital from premium_creator_breakdown view.';

-- =======================
-- Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE ' ';
  RAISE NOTICE '✅ Recreated premium_creator_summary_stats view';
  RAISE NOTICE '   - Dropped by CASCADE in 20251203_fix_premium_creator_metrics_single_row.sql';
  RAISE NOTICE '   - Required by creator_analysis_tool_supabase.js';
  RAISE NOTICE ' ';
END $$;
