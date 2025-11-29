-- Migration: Split event_sequences_raw into portfolio_sequences_raw and creator_sequences_raw
-- Created: 2025-11-28
-- Purpose: Eliminate conflicts and simplify schema by separating event types

-- Create portfolio_sequences_raw table
CREATE TABLE IF NOT EXISTS portfolio_sequences_raw (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  event_name text NOT NULL,
  event_time timestamptz NOT NULL,
  portfolio_ticker text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create creator_sequences_raw table
CREATE TABLE IF NOT EXISTS creator_sequences_raw (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  event_name text NOT NULL,
  event_time timestamptz NOT NULL,
  creator_username text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create unique indexes
CREATE UNIQUE INDEX idx_portfolio_sequences_raw_unique
ON portfolio_sequences_raw (user_id, event_time, portfolio_ticker);

CREATE UNIQUE INDEX idx_creator_sequences_raw_unique
ON creator_sequences_raw (user_id, event_time, creator_username);

-- Create regular indexes for queries
CREATE INDEX idx_portfolio_sequences_raw_user_id
ON portfolio_sequences_raw(user_id);

CREATE INDEX idx_portfolio_sequences_raw_event_time
ON portfolio_sequences_raw(event_time);

CREATE INDEX idx_creator_sequences_raw_user_id
ON creator_sequences_raw(user_id);

CREATE INDEX idx_creator_sequences_raw_event_time
ON creator_sequences_raw(event_time);

-- Migrate existing data from event_sequences_raw
-- Portfolio events (where portfolio_ticker IS NOT NULL)
INSERT INTO portfolio_sequences_raw (user_id, event_name, event_time, portfolio_ticker)
SELECT user_id, event_name, event_time, portfolio_ticker
FROM event_sequences_raw
WHERE event_name = 'Viewed Portfolio Details'
  AND portfolio_ticker IS NOT NULL
ON CONFLICT (user_id, event_time, portfolio_ticker) DO NOTHING;

-- Creator events (where creator_username IS NOT NULL)
INSERT INTO creator_sequences_raw (user_id, event_name, event_time, creator_username)
SELECT user_id, event_name, event_time, creator_username
FROM event_sequences_raw
WHERE event_name = 'Viewed Creator Profile'
  AND creator_username IS NOT NULL
ON CONFLICT (user_id, event_time, creator_username) DO NOTHING;

-- Create views that join with user_first_copies
CREATE OR REPLACE VIEW portfolio_sequences AS
SELECT
  ps.id,
  ps.user_id,
  ps.event_name,
  ps.event_time,
  ps.portfolio_ticker,
  fc.first_copy_time
FROM portfolio_sequences_raw ps
LEFT JOIN user_first_copies fc ON ps.user_id = fc.user_id;

CREATE OR REPLACE VIEW creator_sequences AS
SELECT
  cs.id,
  cs.user_id,
  cs.event_name,
  cs.event_time,
  cs.creator_username,
  fc.first_copy_time
FROM creator_sequences_raw cs
LEFT JOIN user_first_copies fc ON cs.user_id = fc.user_id;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio_sequences_raw TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON creator_sequences_raw TO service_role, authenticated;
GRANT SELECT ON portfolio_sequences TO service_role, authenticated, anon;
GRANT SELECT ON creator_sequences TO service_role, authenticated, anon;
GRANT USAGE ON SEQUENCE portfolio_sequences_raw_id_seq TO service_role, authenticated;
GRANT USAGE ON SEQUENCE creator_sequences_raw_id_seq TO service_role, authenticated;

-- Add comments
COMMENT ON TABLE portfolio_sequences_raw IS
'Raw portfolio view events from Mixpanel. Populated by sync-portfolio-sequences edge function.';

COMMENT ON TABLE creator_sequences_raw IS
'Raw creator profile view events from Mixpanel. Populated by sync-creator-sequences edge function.';

COMMENT ON VIEW portfolio_sequences IS
'Portfolio view events joined with first_copy_time. Use for portfolio conversion analysis.
Filter pre-copy events: WHERE event_time < first_copy_time';

COMMENT ON VIEW creator_sequences IS
'Creator profile view events joined with first_copy_time. Use for creator conversion analysis.
Filter pre-copy events: WHERE event_time < first_copy_time';

COMMENT ON INDEX idx_portfolio_sequences_raw_unique IS
'Ensures uniqueness for portfolio events on (user_id, event_time, portfolio_ticker)';

COMMENT ON INDEX idx_creator_sequences_raw_unique IS
'Ensures uniqueness for creator events on (user_id, event_time, creator_username)';

-- Log the migration results
DO $$
DECLARE
  portfolio_count INTEGER;
  creator_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO portfolio_count FROM portfolio_sequences_raw;
  SELECT COUNT(*) INTO creator_count FROM creator_sequences_raw;

  RAISE NOTICE '';
  RAISE NOTICE '✅ Split event_sequences into separate tables';
  RAISE NOTICE '   - Created portfolio_sequences_raw with % rows', portfolio_count;
  RAISE NOTICE '   - Created creator_sequences_raw with % rows', creator_count;
  RAISE NOTICE '   - Created portfolio_sequences view (joins with user_first_copies)';
  RAISE NOTICE '   - Created creator_sequences view (joins with user_first_copies)';
  RAISE NOTICE '   - Each table has independent unique constraint';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  Note: event_sequences_raw table still exists for reference';
  RAISE NOTICE '   Drop it manually after confirming new tables work correctly';
  RAISE NOTICE '';
END $$;
