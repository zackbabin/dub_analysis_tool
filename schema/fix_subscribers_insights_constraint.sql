-- Fix subscribers_insights to use distinct_id as unique key
-- This ensures one row per user that gets updated on each sync

-- Drop the incorrect composite unique constraint
ALTER TABLE subscribers_insights
DROP CONSTRAINT IF EXISTS subscribers_insights_unique_key;

-- Add the correct unique constraint on just distinct_id
ALTER TABLE subscribers_insights
ADD CONSTRAINT subscribers_insights_unique_key
UNIQUE (distinct_id);

-- Update comment to reflect new behavior
COMMENT ON TABLE subscribers_insights IS
'User-level behavioral and demographic data from Mixpanel.
Each row represents a unique user (distinct_id) and is updated on each sync.
The updated_at timestamp tracks when the user''s data was last refreshed.';

COMMENT ON COLUMN subscribers_insights.synced_at IS
'Timestamp when this user record was first created in the database';

COMMENT ON COLUMN subscribers_insights.updated_at IS
'Timestamp when this user record was last updated from Mixpanel';
