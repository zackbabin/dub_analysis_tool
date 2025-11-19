-- Create view for portfolio-creator copy analysis
-- Computes did_copy from copy_count to ensure accurate pattern analysis
-- This view is used by analyze-conversion-patterns edge function for portfolio combinations

CREATE OR REPLACE VIEW user_portfolio_creator_copies AS
SELECT
    distinct_id,
    portfolio_ticker,
    creator_id,
    creator_username,
    pdp_view_count,
    copy_count,
    liquidation_count,
    (copy_count > 0) as did_copy,
    synced_at
FROM user_portfolio_creator_engagement;

-- Grant access to service role
GRANT SELECT ON user_portfolio_creator_copies TO service_role;
GRANT SELECT ON user_portfolio_creator_copies TO authenticated;
GRANT SELECT ON user_portfolio_creator_copies TO anon;
