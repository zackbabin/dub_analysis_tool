-- RPC function to upload and enrich creator data
-- Joins uploaded data with existing creators_insights to preserve metrics

CREATE OR REPLACE FUNCTION upload_creator_data(
  creator_data JSONB[]
) RETURNS TABLE (
  creator_id TEXT,
  creator_username TEXT,
  raw_data JSONB,
  total_copies INTEGER,
  total_subscriptions INTEGER,
  total_investment_count INTEGER,
  total_investments NUMERIC
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
    COALESCE(existing.total_subscriptions, 0)::integer as total_subscriptions,
    COALESCE(existing.total_investment_count, 0)::integer as total_investment_count,
    COALESCE(existing.total_investments, 0)::numeric as total_investments
  FROM uploaded
  LEFT JOIN creators_insights existing
    ON uploaded.creator_username = existing.creator_username;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the function
COMMENT ON FUNCTION upload_creator_data(JSONB[]) IS 'Enriches uploaded creator data by joining with existing creators_insights to preserve total_copies and total_subscriptions metrics';
