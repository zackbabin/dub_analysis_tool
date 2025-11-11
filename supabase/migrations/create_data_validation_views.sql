-- Migration: Create data validation views for premium creator metrics
-- Purpose: Compare metrics across different aggregation paths to identify discrepancies
-- Impact: 100% read-only - creates views for validation only, does not modify any data
-- Date: 2025-11-10

-- Validation View 1: Compare liquidations between Premium Creator Breakdown and Copy Affinity
CREATE OR REPLACE VIEW validation_liquidations_comparison AS
SELECT
  COALESCE(pcb.creator_username, pad.premium_creator) AS creator_username,
  pcb.total_liquidations AS breakdown_liquidations,
  pad.premium_creator_total_liquidations AS affinity_liquidations,
  ABS(COALESCE(pcb.total_liquidations, 0) - COALESCE(pad.premium_creator_total_liquidations, 0)) AS difference,
  CASE
    WHEN pcb.total_liquidations IS NULL THEN 'Missing in Breakdown'
    WHEN pad.premium_creator_total_liquidations IS NULL THEN 'Missing in Affinity'
    WHEN pcb.total_liquidations = pad.premium_creator_total_liquidations THEN 'Match'
    ELSE 'Discrepancy'
  END AS status
FROM premium_creator_breakdown pcb
FULL OUTER JOIN premium_creator_affinity_display pad
  ON pcb.creator_username = pad.premium_creator
WHERE pcb.total_liquidations != pad.premium_creator_total_liquidations
   OR pcb.total_liquidations IS NULL
   OR pad.premium_creator_total_liquidations IS NULL
ORDER BY difference DESC NULLS LAST;

GRANT SELECT ON validation_liquidations_comparison TO anon, authenticated;

COMMENT ON VIEW validation_liquidations_comparison IS
'Compares liquidations between Premium Creator Breakdown and Copy Affinity to identify discrepancies. Empty result = all match.';

-- Validation View 2: Compare copies between Premium Creator Breakdown and Copy Affinity
CREATE OR REPLACE VIEW validation_copies_comparison AS
SELECT
  COALESCE(pcb.creator_username, pad.premium_creator) AS creator_username,
  pcb.total_copies AS breakdown_copies,
  pad.premium_creator_total_copies AS affinity_copies,
  ABS(COALESCE(pcb.total_copies, 0) - COALESCE(pad.premium_creator_total_copies, 0)) AS difference,
  CASE
    WHEN pcb.total_copies IS NULL THEN 'Missing in Breakdown'
    WHEN pad.premium_creator_total_copies IS NULL THEN 'Missing in Affinity'
    WHEN pcb.total_copies = pad.premium_creator_total_copies THEN 'Match'
    ELSE 'Discrepancy'
  END AS status
FROM premium_creator_breakdown pcb
FULL OUTER JOIN premium_creator_affinity_display pad
  ON pcb.creator_username = pad.premium_creator
WHERE pcb.total_copies != pad.premium_creator_total_copies
   OR pcb.total_copies IS NULL
   OR pad.premium_creator_total_copies IS NULL
ORDER BY difference DESC NULLS LAST;

GRANT SELECT ON validation_copies_comparison TO anon, authenticated;

COMMENT ON VIEW validation_copies_comparison IS
'Compares copies between Premium Creator Breakdown and Copy Affinity to identify discrepancies. Empty result = all match.';

-- Validation View 3: Identify creators with multiple creator_ids
CREATE OR REPLACE VIEW validation_duplicate_creator_ids AS
SELECT
  creator_username,
  COUNT(DISTINCT creator_id) AS creator_id_count,
  ARRAY_AGG(DISTINCT creator_id ORDER BY creator_id) AS creator_ids
FROM premium_creators
GROUP BY creator_username
HAVING COUNT(DISTINCT creator_id) > 1
ORDER BY creator_id_count DESC, creator_username;

GRANT SELECT ON validation_duplicate_creator_ids TO anon, authenticated;

COMMENT ON VIEW validation_duplicate_creator_ids IS
'Lists creators that have multiple creator_ids. These require special handling (MAX aggregation) to avoid double-counting.';

-- Validation View 4: Check subscription consistency across creator_ids
CREATE OR REPLACE VIEW validation_subscription_consistency AS
WITH subscription_per_id AS (
  SELECT
    pc.creator_username,
    pc.creator_id,
    pcm.total_subscriptions
  FROM premium_creators pc
  LEFT JOIN premium_creator_metrics pcm ON pc.creator_id = pcm.creator_id
),
grouped AS (
  SELECT
    creator_username,
    COUNT(DISTINCT creator_id) AS creator_id_count,
    COUNT(DISTINCT total_subscriptions) AS unique_subscription_values,
    ARRAY_AGG(DISTINCT total_subscriptions ORDER BY total_subscriptions DESC) AS subscription_values
  FROM subscription_per_id
  GROUP BY creator_username
)
SELECT
  creator_username,
  creator_id_count,
  unique_subscription_values,
  subscription_values,
  CASE
    WHEN creator_id_count > 1 AND unique_subscription_values > 1 THEN 'INCONSISTENT'
    WHEN creator_id_count > 1 AND unique_subscription_values = 1 THEN 'Consistent'
    ELSE 'Single creator_id'
  END AS status
FROM grouped
WHERE creator_id_count > 1
ORDER BY unique_subscription_values DESC, creator_username;

GRANT SELECT ON validation_subscription_consistency TO anon, authenticated;

COMMENT ON VIEW validation_subscription_consistency IS
'Checks if creators with multiple creator_ids have consistent subscription counts. INCONSISTENT status indicates data quality issue.';

-- Validation View 5: View freshness check
CREATE OR REPLACE VIEW validation_view_freshness AS
SELECT
  view_name,
  last_refreshed_at,
  EXTRACT(EPOCH FROM (NOW() - last_refreshed_at))::INTEGER AS seconds_since_refresh,
  CASE
    WHEN last_refreshed_at IS NULL THEN 'Never refreshed'
    WHEN EXTRACT(EPOCH FROM (NOW() - last_refreshed_at)) < 3600 THEN 'Fresh (< 1 hour)'
    WHEN EXTRACT(EPOCH FROM (NOW() - last_refreshed_at)) < 86400 THEN 'Moderate (< 1 day)'
    ELSE 'Stale (> 1 day)'
  END AS freshness_status,
  refresh_duration_ms,
  rows_affected
FROM materialized_view_refresh_log
ORDER BY last_refreshed_at DESC NULLS LAST;

GRANT SELECT ON validation_view_freshness TO anon, authenticated;

COMMENT ON VIEW validation_view_freshness IS
'Shows when each materialized view was last refreshed and how stale the data is. Use this to identify views that need refreshing.';

-- Validation View 6: Aggregation method summary (documentation)
CREATE OR REPLACE VIEW validation_aggregation_methods AS
SELECT * FROM (VALUES
  ('premium_creator_breakdown', 'total_copies', 'SUM', 'portfolio_creator_engagement_metrics', 'Sum across all portfolios per creator'),
  ('premium_creator_breakdown', 'total_pdp_views', 'SUM', 'portfolio_creator_engagement_metrics', 'Sum across all portfolios per creator'),
  ('premium_creator_breakdown', 'total_liquidations', 'SUM', 'portfolio_creator_engagement_metrics', 'Sum across all portfolios per creator'),
  ('premium_creator_breakdown', 'total_subscriptions', 'MAX', 'premium_creator_metrics', 'MAX to avoid double-counting duplicate creator_ids'),
  ('premium_creator_breakdown', 'total_paywall_views', 'MAX', 'premium_creator_metrics', 'MAX to avoid double-counting duplicate creator_ids'),
  ('premium_creator_breakdown', 'total_cancellations', 'MAX', 'premium_creator_metrics', 'MAX to avoid double-counting duplicate creator_ids'),
  ('premium_creator_breakdown', 'avg_all_time_returns', 'AVG', 'portfolio_performance_metrics', 'Average returns across all portfolios'),
  ('premium_creator_breakdown', 'total_copy_capital', 'SUM', 'portfolio_performance_metrics', 'Total capital across all portfolios'),
  ('premium_creator_affinity_display', 'premium_creator_total_copies', 'SUM', 'premium_creator_portfolio_metrics_latest', 'Sum across all portfolios per creator'),
  ('premium_creator_affinity_display', 'premium_creator_total_liquidations', 'SUM', 'premium_creator_portfolio_metrics_latest', 'Sum across all portfolios per creator'),
  ('top_stocks_all_premium_creators', 'total_quantity', 'SUM', 'premium_creator_stock_holdings', 'Sum across all creators for each stock'),
  ('premium_creator_top_5_stocks', 'top_stocks', 'ARRAY_AGG', 'premium_creator_stock_holdings', 'Top 5 stocks per creator by quantity')
) AS t(view_name, metric_name, aggregation_method, source, description);

GRANT SELECT ON validation_aggregation_methods TO anon, authenticated;

COMMENT ON VIEW validation_aggregation_methods IS
'Documents the aggregation method used for each metric in each view. Reference this when debugging discrepancies.';

-- Summary function to run all validations
CREATE OR REPLACE FUNCTION run_all_validations()
RETURNS TABLE(
  validation_name TEXT,
  issue_count BIGINT,
  status TEXT
) AS $$
BEGIN
  -- Check liquidations discrepancies
  RETURN QUERY
  SELECT
    'Liquidations Comparison'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM validation_liquidations_comparison
  WHERE status = 'Discrepancy';

  -- Check copies discrepancies
  RETURN QUERY
  SELECT
    'Copies Comparison'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM validation_copies_comparison
  WHERE status = 'Discrepancy';

  -- Check duplicate creator_ids
  RETURN QUERY
  SELECT
    'Duplicate Creator IDs'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARNING' END
  FROM validation_duplicate_creator_ids;

  -- Check subscription consistency
  RETURN QUERY
  SELECT
    'Subscription Consistency'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM validation_subscription_consistency
  WHERE status = 'INCONSISTENT';

  -- Check view freshness
  RETURN QUERY
  SELECT
    'Stale Views (> 1 day)'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARNING' END
  FROM validation_view_freshness
  WHERE freshness_status = 'Stale (> 1 day)';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION run_all_validations IS
'Runs all validation checks and returns summary. Use this to quickly check data quality after sync/refresh.';
