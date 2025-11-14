-- Add lifetime_copied_portfolios and active_copied_portfolios columns to subscribers_insights
-- These columns track portfolios that users have copied (vs created)

ALTER TABLE subscribers_insights
ADD COLUMN IF NOT EXISTS lifetime_copied_portfolios INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS active_copied_portfolios INTEGER DEFAULT 0;

-- Add indexes for these new columns
CREATE INDEX IF NOT EXISTS idx_subscribers_lifetime_copied_portfolios
ON subscribers_insights(lifetime_copied_portfolios)
WHERE lifetime_copied_portfolios > 0;

CREATE INDEX IF NOT EXISTS idx_subscribers_active_copied_portfolios
ON subscribers_insights(active_copied_portfolios)
WHERE active_copied_portfolios > 0;

-- Add column comments
COMMENT ON COLUMN subscribers_insights.lifetime_copied_portfolios IS
'Total number of portfolios this user has ever copied (from Mixpanel lifetimeCopiedPortfolios)';

COMMENT ON COLUMN subscribers_insights.active_copied_portfolios IS
'Number of portfolios this user currently has copied/active (from Mixpanel activeCopiedPortfolios)';
