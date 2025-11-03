-- Normalize portfolio_ticker to remove $ prefix inconsistency
-- Problem: View events use $TICKER while copy events use TICKER (no $)
-- This causes them to be treated as different portfolios
-- Solution: Merge rows by adding metrics from non-$ ticker to $ ticker, then delete non-$ rows

-- Step 1: Merge data from non-$ tickers into $ tickers
-- For rows where both $TICKER and TICKER exist for same (distinct_id, creator_id)
INSERT INTO user_portfolio_creator_engagement (
  distinct_id,
  portfolio_ticker,
  creator_id,
  creator_username,
  pdp_view_count,
  did_copy,
  copy_count,
  liquidation_count,
  synced_at
)
SELECT
  no_dollar.distinct_id,
  '$' || no_dollar.portfolio_ticker as portfolio_ticker,
  no_dollar.creator_id,
  no_dollar.creator_username,
  no_dollar.pdp_view_count,
  no_dollar.did_copy,
  no_dollar.copy_count,
  no_dollar.liquidation_count,
  no_dollar.synced_at
FROM user_portfolio_creator_engagement no_dollar
WHERE no_dollar.portfolio_ticker NOT LIKE '$%'
  AND no_dollar.portfolio_ticker IS NOT NULL
  AND no_dollar.portfolio_ticker != ''
ON CONFLICT (distinct_id, portfolio_ticker, creator_id)
DO UPDATE SET
  pdp_view_count = user_portfolio_creator_engagement.pdp_view_count + EXCLUDED.pdp_view_count,
  copy_count = user_portfolio_creator_engagement.copy_count + EXCLUDED.copy_count,
  liquidation_count = user_portfolio_creator_engagement.liquidation_count + EXCLUDED.liquidation_count,
  did_copy = user_portfolio_creator_engagement.did_copy OR EXCLUDED.did_copy,
  synced_at = GREATEST(user_portfolio_creator_engagement.synced_at, EXCLUDED.synced_at);

-- Step 2: Delete the non-$ ticker rows (they've been merged into $ ticker rows)
DELETE FROM user_portfolio_creator_engagement
WHERE portfolio_ticker NOT LIKE '$%'
  AND portfolio_ticker IS NOT NULL
  AND portfolio_ticker != '';

-- Step 3: Refresh materialized views to reflect normalized data
REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
REFRESH MATERIALIZED VIEW hidden_gems_portfolios;

-- Verify the fix
SELECT
  COUNT(*) as total_portfolios,
  COUNT(*) FILTER (WHERE unique_viewers >= 10 AND unique_copiers > 0) as portfolios_with_viewers_and_copiers
FROM portfolio_creator_engagement_metrics;
