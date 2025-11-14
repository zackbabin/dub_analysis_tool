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
-- - subscribers_insights_v2_pkey (PRIMARY KEY on distinct_id)
-- Note: Constraint names kept as v2 for simplicity

-- Check 3: Verify critical indexes exist
DO $$
DECLARE
  index_count INTEGER;
BEGIN
  -- Primary key
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE tablename = 'subscribers_insights'
  AND indexname LIKE '%pkey%';

  IF index_count = 0 THEN
    RAISE EXCEPTION '❌ Missing PRIMARY KEY index on subscribers_insights';
  ELSE
    RAISE NOTICE '✅ PRIMARY KEY exists';
  END IF;

  -- Verify distinct_id has a unique constraint (either as PK or separate unique index)
  SELECT COUNT(*) INTO index_count
  FROM pg_constraint
  WHERE conrelid = 'subscribers_insights'::regclass
  AND contype IN ('p', 'u')
  AND 'distinct_id' = ANY(
    SELECT attname FROM pg_attribute
    WHERE attrelid = 'subscribers_insights'::regclass
    AND attnum = ANY(conkey)
  );

  IF index_count = 0 THEN
    RAISE EXCEPTION '❌ Missing UNIQUE constraint on distinct_id';
  ELSE
    RAISE NOTICE '✅ UNIQUE constraint on distinct_id exists';
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

-- Check 7: Verify sequence exists (v2 uses distinct_id as PK, no id column)
-- Note: v2 doesn't use a sequence since distinct_id is the primary key (not auto-incrementing)
SELECT
  'subscribers_insights_v2' as note,
  'No sequence needed - uses distinct_id as PRIMARY KEY' as status;

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

DO $$
BEGIN
  RAISE NOTICE '✅ Index and constraint verification complete';
  RAISE NOTICE '📋 Review the query results above to ensure:';
  RAISE NOTICE '  1. All expected indexes exist';
  RAISE NOTICE '  2. PRIMARY KEY and UNIQUE constraints are in place';
  RAISE NOTICE '  3. RLS is enabled with correct policies';
  RAISE NOTICE '  4. No sequence needed (v2 uses distinct_id as PK)';
  RAISE NOTICE '  5. updated_at trigger exists';
END $$;
