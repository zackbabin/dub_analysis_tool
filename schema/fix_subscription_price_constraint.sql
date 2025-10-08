-- Fix unique constraint for creator_subscriptions_by_price
-- Each creator can have multiple price points and intervals
-- Change from UNIQUE(creator_id, synced_at) to UNIQUE(creator_id, subscription_price, subscription_interval, synced_at)

-- Drop the old constraint
ALTER TABLE creator_subscriptions_by_price
DROP CONSTRAINT IF EXISTS creator_subscriptions_by_price_creator_id_synced_at_key;

-- Add the new constraint
ALTER TABLE creator_subscriptions_by_price
ADD CONSTRAINT creator_subscriptions_by_price_unique_key
UNIQUE (creator_id, subscription_price, subscription_interval, synced_at);
