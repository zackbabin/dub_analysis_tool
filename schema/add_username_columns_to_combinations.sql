-- Add username and total_views columns to conversion_pattern_combinations table
-- These columns store entity-specific metadata (usernames for creators, tickers for portfolios)
-- Only 2-way combinations are supported, so only _1 and _2 columns are needed

ALTER TABLE conversion_pattern_combinations
ADD COLUMN IF NOT EXISTS username_1 TEXT,
ADD COLUMN IF NOT EXISTS username_2 TEXT,
ADD COLUMN IF NOT EXISTS total_views_1 INTEGER,
ADD COLUMN IF NOT EXISTS total_views_2 INTEGER,
ADD COLUMN IF NOT EXISTS total_conversions INTEGER;

COMMENT ON COLUMN conversion_pattern_combinations.username_1 IS 'Creator username for creator_copy analysis, portfolio ticker for copy analysis';
COMMENT ON COLUMN conversion_pattern_combinations.username_2 IS 'Creator username for creator_copy analysis, portfolio ticker for copy analysis';
COMMENT ON COLUMN conversion_pattern_combinations.total_views_1 IS 'Total views for entity 1 (profile views for creators, PDP views for portfolios)';
COMMENT ON COLUMN conversion_pattern_combinations.total_views_2 IS 'Total views for entity 2 (profile views for creators, PDP views for portfolios)';
COMMENT ON COLUMN conversion_pattern_combinations.total_conversions IS 'Total number of conversions from users exposed to this combination';
