-- Migration: Add function to get event sequences pre-copy metrics
-- Created: 2025-11-23
-- Purpose: Return unique creator profiles and portfolios viewed before copying

CREATE OR REPLACE FUNCTION get_event_sequences_precopy_metrics()
RETURNS TABLE (
  unique_creators BIGINT,
  unique_portfolios BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT creator_username) FILTER (WHERE event_name = 'Viewed Creator Profile' AND creator_username IS NOT NULL) AS unique_creators,
    COUNT(DISTINCT portfolio_ticker) FILTER (WHERE event_name = 'Viewed Portfolio Details' AND portfolio_ticker IS NOT NULL) AS unique_portfolios
  FROM event_sequences_raw;
END;
$$;

COMMENT ON FUNCTION get_event_sequences_precopy_metrics IS
  'Returns unique creator profiles and portfolios viewed from event sequences data';
