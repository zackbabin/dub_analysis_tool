-- Migration: Add first_copy_time to event_sequences view
-- Created: 2025-11-26
-- Purpose: Include first_copy_time in event_sequences to simplify LLM analysis
--          LLM can now filter events with simple: WHERE event_time < first_copy_time

DROP VIEW IF EXISTS event_sequences CASCADE;

CREATE OR REPLACE VIEW event_sequences AS
SELECT
  es.id,
  es.user_id,
  es.event_name,
  es.event_time,
  es.portfolio_ticker,
  fc.first_copy_time
FROM event_sequences_raw es
LEFT JOIN user_first_copies fc ON es.user_id = fc.user_id;

GRANT SELECT ON event_sequences TO service_role, authenticated, anon;

COMMENT ON VIEW event_sequences IS
'Event sequences with first_copy_time joined. Simplified for LLM analysis:
- Filter pre-copy events: WHERE event_time < first_copy_time
- Count unique portfolios: COUNT(DISTINCT portfolio_ticker) WHERE event_time < first_copy_time
- NULL first_copy_time means user never copied';

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added first_copy_time to event_sequences view';
  RAISE NOTICE '   - LEFT JOIN with user_first_copies on user_id';
  RAISE NOTICE '   - Simplifies LLM prompt (single dataset instead of two)';
  RAISE NOTICE '   - LLM can filter: WHERE event_time < first_copy_time';
  RAISE NOTICE '';
END $$;
