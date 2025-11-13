-- Migration Step 6: Verify Indexes and Constraints
-- After table rename, verify all indexes, constraints, and RLS policies are in place

-- ==============================================================================
-- VERIFY TABLE STRUCTURE
-- ==============================================================================

-- Check 1: Verify table exists and has correct name
SELECT
  tablename,
  schemaname,
  hasindexes,
  hasrules,
  hastriggers
FROM pg_tables
WHERE tablename IN ('subscribers_insights', 'subscribers_insights_v1_deprecated')
ORDER BY tablename;

-- ==============================================================================
-- VERIFY INDEXES
-- ==============================================================================

-- Check 2: List all indexes on subscribers_insights
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'subscribers_insights'
ORDER BY indexname;

-- Expected indexes:
-- - subscribers_insights_pkey (PRIMARY KEY on id)
-- - subscribers_insights_distinct_id_key (UNIQUE on distinct_id)
-- - idx_subscribers_synced_at (on synced_at DESC)

-- Check 3: Verify critical indexes exist
DO $$
BEGIN
  -- Primary key
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'subscribers_insights'
    AND indexname = 'subscribers_insights_pkey'
  ) THEN
    RAISE EXCEPTION '❌ Missing PRIMARY KEY index on subscribers_insights';
  ELSE
    RAISE NOTICE '✅ PRIMARY KEY exists';
  END IF;

  -- Unique constraint on distinct_id
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'subscribers_insights'
    AND indexname = 'subscribers_insights_distinct_id_key'
  ) THEN
    RAISE EXCEPTION '❌ Missing UNIQUE index on distinct_id';
  ELSE
    RAISE NOTICE '✅ UNIQUE index on distinct_id exists';
  END IF;
END $$;

-- ==============================================================================
-- VERIFY CONSTRAINTS
-- ==============================================================================

-- Check 4: List all constraints
SELECT
  conname as constraint_name,
  contype as constraint_type,
  CASE contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
    WHEN 'f' THEN 'FOREIGN KEY'
    ELSE 'OTHER'
  END as type_description
FROM pg_constraint
WHERE conrelid = 'subscribers_insights'::regclass
ORDER BY conname;

-- ==============================================================================
-- VERIFY ROW LEVEL SECURITY (RLS)
-- ==============================================================================

-- Check 5: Verify RLS is enabled
SELECT
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'subscribers_insights';

-- Check 6: List RLS policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'subscribers_insights'
ORDER BY policyname;

-- ==============================================================================
-- VERIFY SEQUENCE
-- ==============================================================================

-- Check 7: Verify sequence exists and is linked
SELECT
  seq.relname as sequence_name,
  tab.relname as table_name,
  att.attname as column_name,
  pg_get_serial_sequence('subscribers_insights', 'id') as sequence_link
FROM pg_class seq
JOIN pg_depend dep ON seq.oid = dep.objid
JOIN pg_class tab ON dep.refobjid = tab.oid
JOIN pg_attribute att ON att.attrelid = tab.oid AND att.attnum = dep.refobjsubid
WHERE seq.relkind = 'S'
AND tab.relname = 'subscribers_insights';

-- ==============================================================================
-- VERIFY TRIGGERS
-- ==============================================================================

-- Check 8: List triggers
SELECT
  tgname as trigger_name,
  tgtype,
  proname as function_name
FROM pg_trigger tg
JOIN pg_proc pr ON tg.tgfoid = pr.oid
WHERE tg.tgrelid = 'subscribers_insights'::regclass
AND NOT tgisinternal
ORDER BY tgname;

-- Expected trigger: update_subscribers_insights_updated_at

-- ==============================================================================
-- DATA SANITY CHECK
-- ==============================================================================

-- Check 9: Compare row counts between current and backup
SELECT
  'Current (subscribers_insights)' as table_name,
  COUNT(*) as row_count,
  COUNT(DISTINCT distinct_id) as unique_users,
  MAX(updated_at) as latest_update
FROM subscribers_insights

UNION ALL

SELECT
  'Backup (subscribers_insights_v1_deprecated)' as table_name,
  COUNT(*) as row_count,
  COUNT(DISTINCT distinct_id) as unique_users,
  MAX(updated_at) as latest_update
FROM subscribers_insights_v1_deprecated;

-- ==============================================================================
-- FINAL STATUS
-- ==============================================================================

RAISE NOTICE '✅ Index and constraint verification complete';
RAISE NOTICE '📋 Review the query results above to ensure:';
RAISE NOTICE '  1. All expected indexes exist';
RAISE NOTICE '  2. PRIMARY KEY and UNIQUE constraints are in place';
RAISE NOTICE '  3. RLS is enabled with correct policies';
RAISE NOTICE '  4. Sequence is properly linked';
RAISE NOTICE '  5. updated_at trigger exists';
