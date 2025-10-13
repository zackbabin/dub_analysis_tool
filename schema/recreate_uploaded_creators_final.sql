-- Final fix for uploaded_creators table
-- Run this in Supabase SQL Editor

-- Step 1: Drop everything related to uploaded_creators
DROP VIEW IF EXISTS creator_analysis CASCADE;
DROP TABLE IF EXISTS uploaded_creators CASCADE;

-- Step 2: Create the table with correct schema
CREATE TABLE uploaded_creators (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    creator_username text,
    email text NOT NULL,
    raw_data jsonb NOT NULL,
    uploaded_at timestamp with time zone DEFAULT NOW(),
    CONSTRAINT uploaded_creators_email_uploaded_at_key UNIQUE (email, uploaded_at)
);

-- Step 3: Create index for performance
CREATE INDEX IF NOT EXISTS idx_uploaded_creators_email ON uploaded_creators(email);
CREATE INDEX IF NOT EXISTS idx_uploaded_creators_uploaded_at ON uploaded_creators(uploaded_at);

-- Step 4: Recreate the creator_analysis view
CREATE OR REPLACE VIEW creator_analysis AS
SELECT
  uc.id,
  uc.creator_username,
  uc.email,
  uc.raw_data,
  uc.uploaded_at
FROM uploaded_creators uc
WHERE uc.uploaded_at = (SELECT MAX(uploaded_at) FROM uploaded_creators);

-- Step 5: Grant permissions
GRANT ALL ON uploaded_creators TO authenticated;
GRANT ALL ON uploaded_creators TO service_role;
GRANT SELECT ON creator_analysis TO authenticated;
GRANT SELECT ON creator_analysis TO service_role;

-- Step 6: Force schema reload (multiple methods)
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- Step 7: Verify table exists
SELECT
  'uploaded_creators' as table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'uploaded_creators'
ORDER BY ordinal_position;
