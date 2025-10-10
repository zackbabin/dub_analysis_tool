-- Update business_assumptions table to use total_rebalances instead of rebalances_per_user

-- Rename column from rebalances_per_user to total_rebalances
ALTER TABLE business_assumptions
RENAME COLUMN rebalances_per_user TO total_rebalances;

-- Add comment to explain the column
COMMENT ON COLUMN business_assumptions.total_rebalances IS 'Average of "A. Total Rebalances" metric from Mixpanel (not per-user average)';
