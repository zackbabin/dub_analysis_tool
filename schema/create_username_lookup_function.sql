-- Drop old function first to avoid conflicts
DROP FUNCTION IF EXISTS get_distinct_creator_usernames(TEXT[]);

-- Create optimized function to get distinct creator usernames
-- This avoids scanning millions of duplicate rows in the raw data tables
CREATE OR REPLACE FUNCTION get_distinct_creator_usernames(creator_ids TEXT[])
RETURNS TABLE (creator_id TEXT, creator_username TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (upcv.creator_id)
    upcv.creator_id::TEXT,
    upcv.creator_username::TEXT
  FROM user_portfolio_creator_views upcv
  WHERE upcv.creator_id = ANY(creator_ids)
    AND upcv.creator_username IS NOT NULL
    AND upcv.creator_username != ''
  ORDER BY upcv.creator_id;
END;
$$;

-- Add comment
COMMENT ON FUNCTION get_distinct_creator_usernames IS
'Returns distinct creator_id to username mappings for given creator IDs.
Used to efficiently map creator IDs to usernames without scanning duplicate rows.';
