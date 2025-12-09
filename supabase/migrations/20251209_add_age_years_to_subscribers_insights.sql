-- Add age_years column to subscribers_insights table
-- Stores the user's age in years (current year - Birth Year from Mixpanel)

ALTER TABLE subscribers_insights
ADD COLUMN IF NOT EXISTS age_years INTEGER;

COMMENT ON COLUMN subscribers_insights.age_years IS
  'User age in years, calculated as current year minus Birth Year from Mixpanel';

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ Added age_years column to subscribers_insights';
  RAISE NOTICE '   - Type: INTEGER';
  RAISE NOTICE '   - Calculated as: current year - Birth Year';
END $$;
