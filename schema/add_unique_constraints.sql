-- Add unique constraints to prevent duplicate rows
-- Run this migration AFTER cleaning up existing duplicates

-- For user_portfolio_creator_views:
-- Natural key: (distinct_id, portfolio_ticker, creator_id)
-- This represents a unique user-portfolio-creator interaction
ALTER TABLE user_portfolio_creator_views
ADD CONSTRAINT user_portfolio_creator_views_unique_key
UNIQUE (distinct_id, portfolio_ticker, creator_id);

-- For user_portfolio_creator_copies:
-- Natural key: (distinct_id, portfolio_ticker, creator_id)
-- This represents a unique user-portfolio-creator interaction
ALTER TABLE user_portfolio_creator_copies
ADD CONSTRAINT user_portfolio_creator_copies_unique_key
UNIQUE (distinct_id, portfolio_ticker, creator_id);

-- Note: If you have existing duplicates, first run:
-- 1. Identify duplicates: SELECT distinct_id, portfolio_ticker, creator_id, COUNT(*) FROM user_portfolio_creator_views GROUP BY distinct_id, portfolio_ticker, creator_id HAVING COUNT(*) > 1;
-- 2. Keep only the most recent: DELETE FROM user_portfolio_creator_views WHERE id NOT IN (SELECT MAX(id) FROM user_portfolio_creator_views GROUP BY distinct_id, portfolio_ticker, creator_id);
-- 3. Then run this migration
