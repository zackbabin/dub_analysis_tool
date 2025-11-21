-- Fix: Make materialized view refresh more robust
-- Handle cases where CONCURRENT refresh might fail

DROP FUNCTION IF EXISTS refresh_enriched_support_conversations();

CREATE OR REPLACE FUNCTION refresh_enriched_support_conversations()
RETURNS void AS $$
DECLARE
  old_timeout text;
BEGIN
  -- Save current timeout and extend to 5 minutes for this operation
  SELECT current_setting('statement_timeout') INTO old_timeout;
  SET LOCAL statement_timeout = '300s';

  -- Try concurrent refresh first (safer, but requires unique index)
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY enriched_support_conversations;
    RAISE NOTICE 'Refreshed materialized view (concurrent mode)';
  EXCEPTION
    WHEN OTHERS THEN
      -- Fall back to non-concurrent refresh if concurrent fails
      RAISE NOTICE 'Concurrent refresh failed, falling back to non-concurrent';
      REFRESH MATERIALIZED VIEW enriched_support_conversations;
      RAISE NOTICE 'Refreshed materialized view (non-concurrent mode)';
  END;

  -- Restore original timeout
  EXECUTE 'SET LOCAL statement_timeout = ' || quote_literal(old_timeout);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
