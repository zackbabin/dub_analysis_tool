-- Cleanup duplicate rows before adding unique constraints
-- This keeps only the most recent row for each unique combination

-- Step 1: Check for duplicates in user_portfolio_creator_views
SELECT
  distinct_id,
  portfolio_ticker,
  creator_id,
  COUNT(*) as duplicate_count
FROM user_portfolio_creator_views
GROUP BY distinct_id, portfolio_ticker, creator_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 10;

-- Step 2: Remove duplicates from user_portfolio_creator_views (keep most recent by ID)
DELETE FROM user_portfolio_creator_views
WHERE id NOT IN (
  SELECT MAX(id)
  FROM user_portfolio_creator_views
  GROUP BY distinct_id, portfolio_ticker, creator_id
);

-- Step 3: Check for duplicates in user_portfolio_creator_copies
SELECT
  distinct_id,
  portfolio_ticker,
  creator_id,
  COUNT(*) as duplicate_count
FROM user_portfolio_creator_copies
GROUP BY distinct_id, portfolio_ticker, creator_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 10;

-- Step 4: Remove duplicates from user_portfolio_creator_copies (keep most recent by ID)
DELETE FROM user_portfolio_creator_copies
WHERE id NOT IN (
  SELECT MAX(id)
  FROM user_portfolio_creator_copies
  GROUP BY distinct_id, portfolio_ticker, creator_id
);

-- After running this, apply the unique constraints from add_unique_constraints.sql
