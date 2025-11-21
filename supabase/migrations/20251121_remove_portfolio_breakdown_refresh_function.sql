-- Remove refresh_portfolio_breakdown_view function (no longer needed with regular view)

DROP FUNCTION IF EXISTS refresh_portfolio_breakdown_view();

-- Add comment explaining removal
COMMENT ON VIEW portfolio_breakdown_with_metrics IS 'Portfolio breakdown with engagement and performance metrics. Regular view (converted from materialized) - always shows current data from underlying tables. No refresh function needed.';
