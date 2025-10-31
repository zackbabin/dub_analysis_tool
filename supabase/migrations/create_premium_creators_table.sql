-- Migration: Create premium_creators table
-- Description: Stores the authoritative list of premium creators from Mixpanel chart 85725073
-- Premium creators are creators who have subscription products (paywalled content)

CREATE TABLE IF NOT EXISTS premium_creators (
  creator_id TEXT PRIMARY KEY,
  creator_username TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for username lookups
CREATE INDEX IF NOT EXISTS idx_premium_creators_username
ON premium_creators(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creators TO authenticated, anon, service_role;
