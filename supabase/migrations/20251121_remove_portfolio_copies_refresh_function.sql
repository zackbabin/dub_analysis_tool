-- Remove refresh_portfolio_copies function (no longer needed with regular view)

DROP FUNCTION IF EXISTS refresh_portfolio_copies();

-- Add comment explaining removal
COMMENT ON VIEW user_portfolio_creator_copies IS 'Portfolio-level engagement aggregated by (user, portfolio). Regular view (converted from materialized) - always shows current data. No refresh function needed.';
