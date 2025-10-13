-- Force fix uploaded_creators table and clear all caches
-- This is an aggressive fix for the PostgREST schema cache issue

-- Step 1: Drop any views that depend on uploaded_creators
DROP VIEW IF EXISTS creator_analysis CASCADE;

-- Step 2: Drop the table completely with CASCADE
DROP TABLE IF EXISTS uploaded_creators CASCADE;

-- Step 3: Recreate with correct schema (no creator_id)
CREATE TABLE uploaded_creators (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    creator_username text,
    email text NOT NULL,
    raw_data jsonb NOT NULL,
    uploaded_at timestamp with time zone DEFAULT NOW(),
    UNIQUE(email, uploaded_at)
);

-- Step 4: Recreate creator_analysis view if needed
-- (based on create_creator_analysis_view.sql)
CREATE OR REPLACE VIEW creator_analysis AS
SELECT
  uc.id,
  uc.creator_username,
  uc.email,
  uc.raw_data,
  uc.uploaded_at
FROM uploaded_creators uc
WHERE uc.uploaded_at = (SELECT MAX(uploaded_at) FROM uploaded_creators);

-- Step 5: Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- Step 6: Verify the table structure
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'uploaded_creators'
  AND table_schema = 'public'
ORDER BY ordinal_position;
