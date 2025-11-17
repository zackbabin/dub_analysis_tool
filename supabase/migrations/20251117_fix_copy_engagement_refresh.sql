-- Fix: Make copy_engagement_summary refresh more robust
-- Handle cases where CONCURRENT refresh might fail due to missing unique index

DROP FUNCTION IF EXISTS refresh_copy_engagement_summary();

CREATE OR REPLACE FUNCTION refresh_copy_engagement_summary()
RETURNS void AS $$
BEGIN
  -- Try concurrent refresh first (safer, but requires unique index)
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY copy_engagement_summary;
    RAISE NOTICE 'Refreshed copy_engagement_summary (concurrent mode)';
  EXCEPTION
    WHEN OTHERS THEN
      -- Fall back to non-concurrent refresh if concurrent fails
      RAISE NOTICE 'Concurrent refresh failed, falling back to non-concurrent';
      REFRESH MATERIALIZED VIEW copy_engagement_summary;
      RAISE NOTICE 'Refreshed copy_engagement_summary (non-concurrent mode)';
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: subscription_engagement_summary was dropped in 20251115_drop_subscription_engagement_summary.sql
-- The refresh function for it has been removed in 20251117_remove_orphaned_subscription_refresh_function.sql
