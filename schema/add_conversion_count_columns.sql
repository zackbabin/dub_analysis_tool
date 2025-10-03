-- Add total conversion count columns to conversion_pattern_combinations
-- This allows tracking both unique users and total conversion events

ALTER TABLE conversion_pattern_combinations
ADD COLUMN IF NOT EXISTS total_conversions integer;

-- Add comment to clarify usage
COMMENT ON COLUMN conversion_pattern_combinations.total_conversions IS 'Total count of conversions (subscriptions or copies) for users exposed to this combination. Not unique - same user can have multiple conversions.';

-- Note: users_with_exposure tracks unique users who saw the combination
COMMENT ON COLUMN conversion_pattern_combinations.users_with_exposure IS 'Unique count of users who were exposed to this creator combination';

COMMENT ON COLUMN conversion_pattern_combinations.conversion_rate_in_group IS 'Conversion rate: unique converters / unique users exposed to this combination';
