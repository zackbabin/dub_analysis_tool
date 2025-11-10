-- Migration: Create refresh functions for stock holdings materialized views
-- Description: Adds functions to refresh the three stock holdings materialized views

-- Refresh function for premium_creator_stock_holdings
CREATE OR REPLACE FUNCTION refresh_premium_creator_stock_holdings_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW premium_creator_stock_holdings;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Refresh function for top_stocks_all_premium_creators
CREATE OR REPLACE FUNCTION refresh_top_stocks_all_premium_creators_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW top_stocks_all_premium_creators;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Refresh function for premium_creator_top_5_stocks
CREATE OR REPLACE FUNCTION refresh_premium_creator_top_5_stocks_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW premium_creator_top_5_stocks;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION refresh_premium_creator_stock_holdings_view IS
'Refreshes the premium_creator_stock_holdings materialized view. Call after uploading portfolio stock holdings data.';

COMMENT ON FUNCTION refresh_top_stocks_all_premium_creators_view IS
'Refreshes the top_stocks_all_premium_creators materialized view. Call after uploading portfolio stock holdings data.';

COMMENT ON FUNCTION refresh_premium_creator_top_5_stocks_view IS
'Refreshes the premium_creator_top_5_stocks materialized view. Call after uploading portfolio stock holdings data.';
