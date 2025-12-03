-- Migration: Remove sync_status table
-- Created: 2025-12-03
-- Purpose: Remove redundant sync_status table - all sync functions now use sync_logs
--
-- Background:
-- - sync_logs: Full audit trail of all sync executions (read + write)
-- - sync_status: Was meant to track "last successful sync" for incremental logic
-- - All sync functions have been migrated to read from sync_logs instead
-- - sync_status writes are now redundant and can be removed

DROP TABLE IF EXISTS sync_status CASCADE;

COMMENT ON TABLE sync_logs IS
'Audit log of all sync executions. Used for both historical tracking AND incremental sync logic.
Each sync function reads from this table to determine last successful sync time.';

-- =======================
-- Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Removed sync_status table';
  RAISE NOTICE '   - All sync functions now use sync_logs exclusively';
  RAISE NOTICE '   - sync_logs serves dual purpose: audit trail + incremental sync logic';
  RAISE NOTICE '';
END $$;
