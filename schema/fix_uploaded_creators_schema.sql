-- Fix uploaded_creators table schema
-- Remove creator_id column that is no longer used
-- This resolves the PostgREST schema cache issue

-- Drop the table and recreate with correct schema
DROP TABLE IF EXISTS uploaded_creators CASCADE;

-- Recreate table without creator_id
CREATE TABLE uploaded_creators (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    creator_username text,
    email text NOT NULL,
    raw_data jsonb NOT NULL,
    uploaded_at timestamp with time zone DEFAULT NOW(),
    UNIQUE(email, uploaded_at)
);

-- Create indexes (keeping only the ones that aren't flagged as unused)
-- Note: username and raw_data_gin indexes were flagged as unused, so we're skipping them

-- Refresh the schema cache
NOTIFY pgrst, 'reload schema';

SELECT 'uploaded_creators table recreated without creator_id column' as status;
