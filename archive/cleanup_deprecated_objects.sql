-- Cleanup Script: Remove deprecated database objects
-- Date: 2025-11-18
-- Safe to run - removes unused legacy objects from schema migration

BEGIN;

-- 1. Drop deprecated compatibility view from Nov 2024 migration
DROP VIEW IF EXISTS subscribers_insights_compat CASCADE;

-- 2. Drop deprecated v1 table (replaced by subscribers_insights)
DROP TABLE IF EXISTS subscribers_insights_v1_deprecated CASCADE;

-- 3. Drop unused staging table (replaced by Insights API approach)
DROP TABLE IF EXISTS raw_mixpanel_events_staging CASCADE;

-- Verify drops
DO $$
DECLARE
  dropped_count INT;
BEGIN
  SELECT COUNT(*) INTO dropped_count
  FROM pg_tables 
  WHERE schemaname = 'public' 
  AND tablename IN ('subscribers_insights_v1_deprecated', 'raw_mixpanel_events_staging');
  
  IF dropped_count = 0 THEN
    RAISE NOTICE '✅ Successfully dropped 3 deprecated objects';
    RAISE NOTICE '   - subscribers_insights_compat (view)';
    RAISE NOTICE '   - subscribers_insights_v1_deprecated (table)';
    RAISE NOTICE '   - raw_mixpanel_events_staging (table)';
  ELSE
    RAISE WARNING '⚠️ Some tables may not have been dropped';
  END IF;
END $$;

COMMIT;
