-- Strip $device: prefix from all distinct_id columns across the database
-- Mixpanel uses $device: prefix for anonymous device IDs
-- We want to store clean IDs without the prefix for consistency

-- ============================================================================
-- TABLE: subscribers_insights (main user insights table)
-- ============================================================================
UPDATE subscribers_insights
SET distinct_id = substring(distinct_id FROM 9)
WHERE distinct_id LIKE '$device:%';

-- ============================================================================
-- TABLE: premium_creator_retention_events
-- ============================================================================
UPDATE premium_creator_retention_events
SET distinct_id = substring(distinct_id FROM 9)
WHERE distinct_id LIKE '$device:%';

-- ============================================================================
-- TABLE: event_sequences_raw
-- ============================================================================
UPDATE event_sequences_raw
SET distinct_id = substring(distinct_id FROM 9)
WHERE distinct_id LIKE '$device:%';

-- ============================================================================
-- TABLE: user_creator_engagement
-- ============================================================================
UPDATE user_creator_engagement
SET distinct_id = substring(distinct_id FROM 9)
WHERE distinct_id LIKE '$device:%';

-- ============================================================================
-- TABLE: user_portfolio_creator_engagement
-- ============================================================================
UPDATE user_portfolio_creator_engagement
SET distinct_id = substring(distinct_id FROM 9)
WHERE distinct_id LIKE '$device:%';

-- ============================================================================
-- TABLE: user_event_sequences
-- ============================================================================
UPDATE user_event_sequences
SET distinct_id = substring(distinct_id FROM 9)
WHERE distinct_id LIKE '$device:%';

-- ============================================================================
-- TABLE: creator_engagement_staging
-- ============================================================================
UPDATE creator_engagement_staging
SET distinct_id = substring(distinct_id FROM 9)
WHERE distinct_id LIKE '$device:%';

-- ============================================================================
-- TABLE: portfolio_engagement_staging
-- ============================================================================
UPDATE portfolio_engagement_staging
SET distinct_id = substring(distinct_id FROM 9)
WHERE distinct_id LIKE '$device:%';

-- ============================================================================
-- VERIFICATION: Count remaining $device: prefixes
-- ============================================================================
DO $$
DECLARE
  subscribers_count INT;
  retention_count INT;
  event_sequences_count INT;
  creator_engagement_count INT;
  portfolio_engagement_count INT;
  user_event_sequences_count INT;
  creator_staging_count INT;
  portfolio_staging_count INT;
  total_remaining INT;
BEGIN
  SELECT COUNT(*) INTO subscribers_count FROM subscribers_insights WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO retention_count FROM premium_creator_retention_events WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO event_sequences_count FROM event_sequences_raw WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO creator_engagement_count FROM user_creator_engagement WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO portfolio_engagement_count FROM user_portfolio_creator_engagement WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO user_event_sequences_count FROM user_event_sequences WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO creator_staging_count FROM creator_engagement_staging WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO portfolio_staging_count FROM portfolio_engagement_staging WHERE distinct_id LIKE '$device:%';

  total_remaining := subscribers_count + retention_count + event_sequences_count + creator_engagement_count + portfolio_engagement_count + user_event_sequences_count + creator_staging_count + portfolio_staging_count;

  RAISE NOTICE '✅ Cleaned distinct_id columns across 8 tables';
  RAISE NOTICE '  - subscribers_insights: % remaining with $device: prefix', subscribers_count;
  RAISE NOTICE '  - premium_creator_retention_events: % remaining with $device: prefix', retention_count;
  RAISE NOTICE '  - event_sequences_raw: % remaining with $device: prefix', event_sequences_count;
  RAISE NOTICE '  - user_creator_engagement: % remaining with $device: prefix', creator_engagement_count;
  RAISE NOTICE '  - user_portfolio_creator_engagement: % remaining with $device: prefix', portfolio_engagement_count;
  RAISE NOTICE '  - user_event_sequences: % remaining with $device: prefix', user_event_sequences_count;
  RAISE NOTICE '  - creator_engagement_staging: % remaining with $device: prefix', creator_staging_count;
  RAISE NOTICE '  - portfolio_engagement_staging: % remaining with $device: prefix', portfolio_staging_count;

  IF total_remaining > 0 THEN
    RAISE WARNING '⚠️ % records still have $device: prefix - check for constraint violations or data issues', total_remaining;
  ELSE
    RAISE NOTICE '✓ All $device: prefixes successfully removed';
  END IF;
END $$;
