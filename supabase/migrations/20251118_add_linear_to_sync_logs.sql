-- Add 'linear' to sync_logs tool_type check constraint
-- Allows Linear issue sync to log sync operations

-- Drop the existing constraint
ALTER TABLE sync_logs DROP CONSTRAINT IF EXISTS sync_logs_tool_type_check;

-- Add the updated constraint with 'linear' included
ALTER TABLE sync_logs ADD CONSTRAINT sync_logs_tool_type_check
  CHECK (tool_type = ANY (ARRAY['user'::text, 'creator'::text, 'support'::text, 'linear'::text]));

-- Verify the change
DO $$
BEGIN
  RAISE NOTICE 'Updated sync_logs_tool_type_check constraint to include "linear" tool type';
END $$;
