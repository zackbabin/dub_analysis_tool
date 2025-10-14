-- Fix CASCADE dropped views after consolidating engagement tables
-- When we dropped user_portfolio_creator_copies and user_portfolio_creator_views,
-- CASCADE also dropped: creator_analysis, main_analysis, and several materialized views
-- This script recreates all affected views using the new consolidated table

-- ============================================================================
-- 1. Recreate creator_analysis view
-- ============================================================================

DROP VIEW IF EXISTS creator_analysis CASCADE;

CREATE OR REPLACE VIEW creator_analysis AS
SELECT
    cu.id,
    cu.creator_username,
    cu.email,
    COALESCE((cu.raw_data->>'type')::text, 'Regular') as type,

    -- Extract total_copies and total_subscriptions from raw_data or default to 0
    COALESCE((cu.raw_data->>'total_copies')::integer, 0) as total_copies,
    COALESCE((cu.raw_data->>'total_subscriptions')::integer, 0) as total_subscriptions,

    -- Merge uploaded raw_data with Mixpanel metrics from creators_insights
    -- All Mixpanel columns (except email) will be added to raw_data JSONB
    CASE
        WHEN ci.email IS NOT NULL THEN
            cu.raw_data || jsonb_build_object(
                'total_deposits', ci.total_deposits,
                'active_created_portfolios', ci.active_created_portfolios,
                'lifetime_created_portfolios', ci.lifetime_created_portfolios,
                'total_trades', ci.total_trades,
                'investing_activity', ci.investing_activity,
                'investing_experience_years', ci.investing_experience_years,
                'investing_objective', ci.investing_objective,
                'investment_type', ci.investment_type
            )
        ELSE
            cu.raw_data
    END as raw_data
FROM creator_uploads cu
LEFT JOIN creators_insights ci ON LOWER(TRIM(cu.email)) = LOWER(TRIM(ci.email))
WHERE cu.uploaded_at = (SELECT MAX(uploaded_at) FROM creator_uploads);

COMMENT ON VIEW creator_analysis IS 'Merges uploaded creator data with Mixpanel metrics for correlation analysis';

-- ============================================================================
-- 2. Recreate main_analysis materialized view
-- Updated to use consolidated user_portfolio_creator_engagement table
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

CREATE MATERIALIZED VIEW main_analysis AS
WITH copy_engagement AS (
  SELECT
    distinct_id,
    SUM(profile_view_count) as total_profile_views_calc,
    SUM(pdp_view_count) as total_pdp_views_calc,
    COUNT(DISTINCT creator_id) as unique_creators_viewed,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios_viewed,
    SUM(CASE WHEN did_copy THEN 1 ELSE 0 END) as total_copies_calc,
    MAX(CASE WHEN did_copy THEN 1 ELSE 0 END) as did_copy
  FROM user_portfolio_creator_engagement
  WHERE did_copy = true
  GROUP BY distinct_id
),
subscription_engagement AS (
  SELECT
    distinct_id,
    SUM(CASE WHEN did_subscribe THEN 1 ELSE 0 END) as total_subscriptions_calc,
    MAX(CASE WHEN did_subscribe THEN 1 ELSE 0 END) as did_subscribe
  FROM user_portfolio_creator_engagement
  WHERE did_subscribe = true
  GROUP BY distinct_id
),
time_metrics AS (
  SELECT
    distinct_id,
    MAX(CASE WHEN funnel_type = 'time_to_first_copy' THEN time_in_days END) as time_to_first_copy_days,
    MAX(CASE WHEN funnel_type = 'time_to_linked_bank' THEN time_in_days END) as time_to_linked_bank_days,
    MAX(CASE WHEN funnel_type = 'time_to_funded_account' THEN time_in_days END) as time_to_funded_account_days
  FROM time_funnels
  GROUP BY distinct_id
)
SELECT
  si.distinct_id,
  si.income,
  si.net_worth,
  si.investing_activity,
  si.investing_experience_years,
  si.investing_objective,
  si.investment_type,
  si.acquisition_survey,
  si.linked_bank_account,
  si.available_copy_credits,
  si.buying_power,
  si.total_deposits,
  si.total_deposit_count,
  si.total_withdrawals,
  si.total_withdrawal_count,
  si.active_created_portfolios,
  si.lifetime_created_portfolios,
  COALESCE(ce.total_copies_calc, si.total_copies, 0) as total_copies,
  si.total_regular_copies,
  si.total_premium_copies,
  si.regular_pdp_views,
  si.premium_pdp_views,
  si.paywall_views,
  si.regular_creator_profile_views,
  si.premium_creator_profile_views,
  COALESCE(se.total_subscriptions_calc, si.total_subscriptions, 0) as total_subscriptions,
  si.stripe_modal_views,
  si.app_sessions,
  si.discover_tab_views,
  si.leaderboard_tab_views,
  si.premium_tab_views,
  si.creator_card_taps,
  si.portfolio_card_taps,
  si.subscribed_within_7_days,
  COALESCE(ce.total_profile_views_calc, 0) as total_profile_views,
  COALESCE(ce.total_pdp_views_calc, 0) as total_pdp_views,
  COALESCE(ce.unique_creators_viewed, 0) as unique_creators_viewed,
  COALESCE(ce.unique_portfolios_viewed, 0) as unique_portfolios_viewed,
  COALESCE(ce.did_copy, 0) as did_copy,
  COALESCE(se.did_subscribe, 0) as did_subscribe,
  tm.time_to_first_copy_days,
  tm.time_to_linked_bank_days,
  tm.time_to_funded_account_days
FROM subscribers_insights si
LEFT JOIN copy_engagement ce ON si.distinct_id = ce.distinct_id
LEFT JOIN subscription_engagement se ON si.distinct_id = se.distinct_id
LEFT JOIN time_metrics tm ON si.distinct_id = tm.distinct_id;

-- Create indexes for faster queries on materialized view
CREATE INDEX IF NOT EXISTS idx_main_analysis_distinct_id ON main_analysis (distinct_id);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_copy ON main_analysis (did_copy);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_subscribe ON main_analysis (did_subscribe);
CREATE INDEX IF NOT EXISTS idx_main_analysis_total_copies ON main_analysis (total_copies);
CREATE INDEX IF NOT EXISTS idx_main_analysis_total_subscriptions ON main_analysis (total_subscriptions);
CREATE INDEX IF NOT EXISTS idx_main_analysis_time_to_first_copy ON main_analysis (time_to_first_copy_days) WHERE time_to_first_copy_days IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_main_analysis_time_to_linked_bank ON main_analysis (time_to_linked_bank_days) WHERE time_to_linked_bank_days IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_main_analysis_time_to_funded ON main_analysis (time_to_funded_account_days) WHERE time_to_funded_account_days IS NOT NULL;

-- Create function to refresh main_analysis
CREATE OR REPLACE FUNCTION refresh_main_analysis()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW main_analysis;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION refresh_main_analysis() TO authenticated, anon, service_role;
GRANT SELECT ON main_analysis TO authenticated, anon, service_role;

-- ============================================================================
-- 3. Recreate subscription_engagement_summary materialized view
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS subscription_engagement_summary CASCADE;

CREATE MATERIALIZED VIEW subscription_engagement_summary AS
SELECT
  did_subscribe,
  COUNT(DISTINCT distinct_id) as total_users,
  ROUND(AVG(profile_views), 2) as avg_profile_views,
  ROUND(AVG(pdp_views), 2) as avg_pdp_views,
  ROUND(AVG(unique_creators), 2) as avg_unique_creators,
  ROUND(AVG(unique_portfolios), 2) as avg_unique_portfolios
FROM (
  SELECT
    distinct_id,
    did_subscribe,
    SUM(pdp_view_count + profile_view_count) as pdp_views,
    COUNT(DISTINCT creator_id) as unique_creators,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios,
    SUM(profile_view_count) as profile_views
  FROM user_portfolio_creator_engagement
  GROUP BY distinct_id, did_subscribe
) user_engagement
GROUP BY did_subscribe;

CREATE INDEX IF NOT EXISTS idx_subscription_engagement_summary_did_subscribe
ON subscription_engagement_summary (did_subscribe);

GRANT SELECT ON subscription_engagement_summary TO authenticated, anon, service_role;

-- ============================================================================
-- 4. Recreate hidden gems materialized views
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;
DROP VIEW IF EXISTS creator_profile_view_metrics CASCADE;

-- Recreate portfolio_creator_engagement_metrics
CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  COUNT(DISTINCT distinct_id) as unique_viewers,
  SUM(pdp_view_count) as total_pdp_views,
  SUM(CASE WHEN did_copy THEN 1 ELSE 0 END) as total_copies,
  ROUND(
    (SUM(CASE WHEN did_copy THEN 1 ELSE 0 END)::NUMERIC / NULLIF(COUNT(DISTINCT distinct_id), 0)) * 100,
    2
  ) as conversion_rate_pct
FROM user_portfolio_creator_engagement
GROUP BY portfolio_ticker, creator_id, creator_username;

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

-- Recreate creator_profile_view_metrics
CREATE OR REPLACE VIEW creator_profile_view_metrics AS
SELECT
  creator_id,
  COUNT(DISTINCT distinct_id) as total_profile_views
FROM user_portfolio_creator_engagement
GROUP BY creator_id;

-- Recreate hidden_gems_portfolios
CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
WITH engagement_with_profile_views AS (
  SELECT
    pce.portfolio_ticker,
    pce.creator_id,
    pce.creator_username,
    pce.unique_viewers,
    pce.total_pdp_views,
    pce.total_copies,
    pce.conversion_rate_pct,
    COALESCE(cpv.total_profile_views, 0) as total_profile_views
  FROM portfolio_creator_engagement_metrics pce
  LEFT JOIN creator_profile_view_metrics cpv ON pce.creator_id = cpv.creator_id
),
percentile_thresholds AS (
  SELECT
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_pdp_views) as pdp_views_p50,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_profile_views) as profile_views_p50
  FROM engagement_with_profile_views
)
SELECT
  e.portfolio_ticker,
  e.creator_id,
  e.creator_username,
  e.unique_viewers as unique_views,
  e.total_pdp_views,
  e.total_profile_views,
  e.total_copies,
  ROUND(
    (e.total_copies::NUMERIC / NULLIF(e.unique_viewers, 0)) * 100,
    2
  ) as conversion_rate_pct
FROM engagement_with_profile_views e
CROSS JOIN percentile_thresholds p
WHERE
  -- Must be in top 50% for either PDP views OR profile views
  (e.total_pdp_views >= p.pdp_views_p50 OR e.total_profile_views >= p.profile_views_p50)
  -- Low conversion rate (<=25%)
  AND ROUND((e.total_copies::NUMERIC / NULLIF(e.unique_viewers, 0)) * 100, 2) <= 25
ORDER BY e.total_pdp_views DESC
LIMIT 100;

CREATE INDEX IF NOT EXISTS idx_hidden_gems_portfolios_ticker
ON hidden_gems_portfolios (portfolio_ticker);
CREATE INDEX IF NOT EXISTS idx_hidden_gems_portfolios_creator
ON hidden_gems_portfolios (creator_id);

GRANT SELECT ON portfolio_creator_engagement_metrics TO authenticated, anon, service_role;
GRANT SELECT ON creator_profile_view_metrics TO authenticated, anon, service_role;
GRANT SELECT ON hidden_gems_portfolios TO authenticated, anon, service_role;

-- ============================================================================
-- 5. Refresh PostgREST schema cache
-- ============================================================================

NOTIFY pgrst, 'reload schema';

SELECT 'All CASCADE-dropped views have been recreated successfully' as status;
