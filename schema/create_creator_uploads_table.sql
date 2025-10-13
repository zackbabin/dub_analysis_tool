-- Create new table with different name to bypass PostgREST cache
-- New table: creator_uploads (instead of uploaded_creators)

-- Drop old table and view
DROP VIEW IF EXISTS creator_analysis CASCADE;
DROP TABLE IF EXISTS uploaded_creators CASCADE;

-- Create new table with clean name
CREATE TABLE creator_uploads (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    creator_username text,
    email text NOT NULL,
    raw_data jsonb NOT NULL,
    uploaded_at timestamp with time zone DEFAULT NOW(),
    CONSTRAINT creator_uploads_email_uploaded_at_key UNIQUE (email, uploaded_at)
);

-- Create indexes
CREATE INDEX idx_creator_uploads_email ON creator_uploads(email);
CREATE INDEX idx_creator_uploads_uploaded_at ON creator_uploads(uploaded_at);

-- Recreate view pointing to new table
CREATE OR REPLACE VIEW creator_analysis AS
SELECT
  cu.id,
  cu.creator_username,
  cu.email,
  cu.raw_data,
  cu.uploaded_at
FROM creator_uploads cu
WHERE cu.uploaded_at = (SELECT MAX(uploaded_at) FROM creator_uploads);

-- Grant permissions
GRANT ALL ON creator_uploads TO authenticated;
GRANT ALL ON creator_uploads TO service_role;
GRANT SELECT ON creator_analysis TO authenticated;
GRANT SELECT ON creator_analysis TO service_role;

-- Verify
SELECT 'Table created successfully' as status;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'creator_uploads'
ORDER BY ordinal_position;
