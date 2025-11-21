-- Add stock holdings views back to refresh_portfolio_engagement_views
-- These views depend on portfolio_creator_engagement_metrics (refreshed in this function)
-- AND portfolio_stock_holdings (CSV uploads), so they need to refresh when EITHER changes
-- Date: 2025-11-21

CREATE OR REPLACE FUNCTION refresh_portfolio_engagement_views()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Level 1: Base engagement metrics (depends on user_portfolio_creator_engagement)
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;

  -- Level 2: Views that depend on portfolio_creator_engagement_metrics
  REFRESH MATERIALIZED VIEW hidden_gems_portfolios;

  -- Stock holdings views also depend on portfolio_creator_engagement_metrics
  -- These need to refresh when engagement data changes OR when CSV is uploaded
  REFRESH MATERIALIZED VIEW premium_creator_stock_holdings;

  -- Level 3: Views that depend on premium_creator_stock_holdings
  REFRESH MATERIALIZED VIEW top_stocks_all_premium_creators;
  REFRESH MATERIALIZED VIEW premium_creator_top_5_stocks;

  RETURN 'Successfully refreshed portfolio engagement views and stock holdings views';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION refresh_portfolio_engagement_views() IS
'Refreshes portfolio engagement and stock holdings materialized views in dependency order:
 1. portfolio_creator_engagement_metrics (base)
 2. hidden_gems_portfolios, premium_creator_stock_holdings (depend on base)
 3. top_stocks_all_premium_creators, premium_creator_top_5_stocks (depend on stock holdings)
Called by refresh-materialized-views after engagement sync AND by upload-portfolio-metrics after CSV upload.';
