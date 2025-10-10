-- Migration: Update creators_insights to store Mixpanel user profile data
-- Changes the table from storing creator performance metrics to user profile attributes
-- This table now stores enrichment data that gets merged with uploaded_creators

-- Step 1: Add email column to uploaded_creators if it doesn't exist
ALTER TABLE uploaded_creators
ADD COLUMN IF NOT EXISTS email text;

-- Step 2: Create unique constraint on email in uploaded_creators
ALTER TABLE uploaded_creators
DROP CONSTRAINT IF EXISTS uploaded_creators_email_uploaded_at_key;

ALTER TABLE uploaded_creators
ADD CONSTRAINT uploaded_creators_email_uploaded_at_key UNIQUE (email, uploaded_at);

-- Step 3: Backup existing creators_insights data (if needed for rollback)
-- Uncomment if you want to preserve old data:
-- CREATE TABLE IF NOT EXISTS creators_insights_backup AS SELECT * FROM creators_insights;

-- Step 4: Drop old columns from creators_insights
ALTER TABLE creators_insights
DROP COLUMN IF EXISTS creator_type,
DROP COLUMN IF EXISTS metrics,
DROP COLUMN IF EXISTS total_profile_views,
DROP COLUMN IF EXISTS total_pdp_views,
DROP COLUMN IF EXISTS total_paywall_views,
DROP COLUMN IF EXISTS total_stripe_views,
DROP COLUMN IF EXISTS total_subscriptions,
DROP COLUMN IF EXISTS total_subscription_revenue,
DROP COLUMN IF EXISTS total_cancelled_subscriptions,
DROP COLUMN IF EXISTS total_expired_subscriptions,
DROP COLUMN IF EXISTS total_copies,
DROP COLUMN IF EXISTS total_investment_count,
DROP COLUMN IF EXISTS total_investments;

-- Step 5: Add new Mixpanel user profile columns
ALTER TABLE creators_insights
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS total_deposits numeric,
ADD COLUMN IF NOT EXISTS active_created_portfolios integer,
ADD COLUMN IF NOT EXISTS lifetime_created_portfolios integer,
ADD COLUMN IF NOT EXISTS total_trades integer,
ADD COLUMN IF NOT EXISTS investing_activity text,
ADD COLUMN IF NOT EXISTS investing_experience_years text,
ADD COLUMN IF NOT EXISTS investing_objective text,
ADD COLUMN IF NOT EXISTS investment_type text;

-- Step 6: Drop old unique constraints
ALTER TABLE creators_insights
DROP CONSTRAINT IF EXISTS creators_insights_creator_username_key;

-- Step 7: Add unique constraint on email
ALTER TABLE creators_insights
DROP CONSTRAINT IF EXISTS creators_insights_email_key;

ALTER TABLE creators_insights
ADD CONSTRAINT creators_insights_email_key UNIQUE (email);

-- Step 8: Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_creators_insights_email ON creators_insights(email);

-- Step 9: Drop old indexes that are no longer needed
DROP INDEX IF EXISTS idx_creators_insights_username;

-- Step 10: Clear old data (since schema has changed)
TRUNCATE TABLE creators_insights;

SELECT 'creators_insights table migrated to Mixpanel user profile schema' as status;
