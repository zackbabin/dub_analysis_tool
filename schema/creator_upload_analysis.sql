-- Creator Upload Analysis Schema
-- Stores uploaded creator CSV data + enriches with total_copies and total_subscriptions

-- Step 1: Create uploaded_creators table
CREATE TABLE IF NOT EXISTS uploaded_creators (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    creator_id text NOT NULL,  -- useruuid from CSV
    creator_username text NOT NULL,  -- handle from CSV (with @ prefix)
    raw_data jsonb NOT NULL,  -- All CSV columns stored as-is
    -- Only two enriched columns needed for correlation analysis
    total_copies integer DEFAULT 0,
    total_subscriptions integer DEFAULT 0,
    uploaded_at timestamp with time zone DEFAULT NOW(),
    UNIQUE(creator_username, uploaded_at)
);

-- Step 2: Create indexes
CREATE INDEX IF NOT EXISTS idx_uploaded_creators_username ON uploaded_creators(creator_username);
CREATE INDEX IF NOT EXISTS idx_uploaded_creators_id ON uploaded_creators(creator_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_creators_raw_data_gin ON uploaded_creators USING gin(raw_data);

-- Step 3: Create RPC function to enrich uploads
CREATE OR REPLACE FUNCTION upload_creator_data(
  creator_data JSONB[]
) RETURNS TABLE (
  creator_id TEXT,
  creator_username TEXT,
  raw_data JSONB,
  total_copies INTEGER,
  total_subscriptions INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH uploaded AS (
    SELECT
      (data->>'creator_id')::text as creator_id,
      (data->>'creator_username')::text as creator_username,
      (data->'raw_data')::jsonb as raw_data
    FROM unnest(creator_data) as data
  )
  SELECT
    uploaded.creator_id,
    uploaded.creator_username,
    uploaded.raw_data,
    COALESCE(existing.total_copies, 0)::integer as total_copies,
    COALESCE(existing.total_subscriptions, 0)::integer as total_subscriptions
  FROM uploaded
  LEFT JOIN creators_insights existing
    ON LTRIM(uploaded.creator_username, '@') = LTRIM(existing.creator_username, '@');
END;
$$ LANGUAGE plpgsql;

SELECT 'Creator upload schema created' as status;
