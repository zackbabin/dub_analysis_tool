-- Migration: Add category_name column and update unique constraint for Tapped Portfolio Card events
-- Created: 2025-12-10
-- Purpose: Support "Tapped Portfolio Card" events which include categoryName property
--          Update unique constraint to allow multiple event types for same user/time/ticker

-- Add category_name column
ALTER TABLE portfolio_sequences_raw
ADD COLUMN IF NOT EXISTS category_name text;

-- Drop old unique index (doesn't include event_name)
DROP INDEX IF EXISTS idx_portfolio_sequences_raw_unique;

-- Create new unique index that includes event_name
-- This allows both "Viewed Portfolio Details" and "Tapped Portfolio Card" for same user/time/ticker
CREATE UNIQUE INDEX idx_portfolio_sequences_raw_unique
ON portfolio_sequences_raw (user_id, event_name, event_time, portfolio_ticker);

-- Create index on category_name for filtering
CREATE INDEX IF NOT EXISTS idx_portfolio_sequences_raw_category_name
ON portfolio_sequences_raw(category_name) WHERE category_name IS NOT NULL;

-- Update view to include category_name
CREATE OR REPLACE VIEW portfolio_sequences AS
SELECT
  ps.id,
  ps.user_id,
  ps.event_name,
  ps.event_time,
  ps.portfolio_ticker,
  ps.category_name,
  fc.first_copy_time
FROM portfolio_sequences_raw ps
LEFT JOIN user_first_copies fc ON ps.user_id = fc.user_id;

-- Update comments
COMMENT ON COLUMN portfolio_sequences_raw.category_name IS
'Category name from "Tapped Portfolio Card" events (extracted from categoryName property). NULL for "Viewed Portfolio Details" events.';

COMMENT ON INDEX idx_portfolio_sequences_raw_unique IS
'Ensures uniqueness for portfolio events on (user_id, event_name, event_time, portfolio_ticker). Includes event_name to allow both Viewed and Tapped events for same ticker/time.';

COMMENT ON VIEW portfolio_sequences IS
'Portfolio view events joined with first_copy_time. Includes both "Viewed Portfolio Details" and "Tapped Portfolio Card" events.
Filter pre-copy events: WHERE event_time < first_copy_time
Filter by category: WHERE category_name = ''Top Performing''';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added category_name column to portfolio_sequences_raw';
  RAISE NOTICE '   - Extracted from categoryName property in "Tapped Portfolio Card" events';
  RAISE NOTICE '   - NULL for "Viewed Portfolio Details" events';
  RAISE NOTICE '✅ Updated unique constraint to include event_name';
  RAISE NOTICE '   - Allows both event types for same user/time/ticker';
  RAISE NOTICE '✅ Updated portfolio_sequences view to include category_name';
  RAISE NOTICE '';
END $$;
