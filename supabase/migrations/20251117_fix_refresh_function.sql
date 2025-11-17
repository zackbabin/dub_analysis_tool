-- Fix: Make materialized view refresh more robust
-- Handle cases where CONCURRENT refresh might fail

DROP FUNCTION IF EXISTS refresh_enriched_support_conversations();

CREATE OR REPLACE FUNCTION refresh_enriched_support_conversations()
RETURNS void AS $$
BEGIN
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
