-- Migration: Disable event sequences DB functions
-- Created: 2025-11-24
-- Purpose: Remove expensive event sequences functions that cause DB overload
--
-- CONTEXT:
-- Event sequences workflow is disabled due to high CPU/Disk IO from JSON aggregation.
-- The APPEND operation with json_array_elements + re-sorting was causing performance issues.
-- Dropping functions to prevent accidental usage until workflow is re-architected.
--
-- Related commits: 5ee2eb5 (APPEND logic), cf07cda (optimization attempt)
-- Workflow disabled in: user_analysis_tool_supabase.js (Step 4)

-- Drop event sequences processing function
DROP FUNCTION IF EXISTS process_event_sequences_raw() CASCADE;

-- Drop precopy metrics function
DROP FUNCTION IF EXISTS get_event_sequences_precopy_metrics() CASCADE;

-- Drop sorted sequences function
DROP FUNCTION IF EXISTS get_sorted_event_sequences(text) CASCADE;

COMMENT ON TABLE event_sequences_raw IS
'DISABLED: Event sequences workflow is temporarily disabled due to performance issues.
Raw events are stored here but not processed. See migration 20251124_disable_event_sequences_functions.sql';

COMMENT ON TABLE user_event_sequences IS
'DISABLED: Event sequences workflow is temporarily disabled due to performance issues.
This table is not being updated. See migration 20251124_disable_event_sequences_functions.sql';

-- Log the change
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Disabled event sequences DB functions';
  RAISE NOTICE '   - Dropped process_event_sequences_raw()';
  RAISE NOTICE '   - Dropped get_event_sequences_precopy_metrics()';
  RAISE NOTICE '   - Dropped get_sorted_event_sequences()';
  RAISE NOTICE '   - Workflow disabled in user_analysis_tool_supabase.js';
  RAISE NOTICE '';
END $$;
