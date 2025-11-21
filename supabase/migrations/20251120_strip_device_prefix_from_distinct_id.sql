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
-- TABLE: subscribers_insights_v2 (v2 user insights table)
-- ============================================================================
UPDATE subscribers_insights_v2
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
-- TABLE: user_creator_engagement (if it has distinct_id)
-- ============================================================================
UPDATE user_creator_engagement
SET distinct_id = substring(distinct_id FROM 9)
WHERE distinct_id LIKE '$device:%';

-- ============================================================================
-- TABLE: user_portfolio_creator_engagement (if it has distinct_id)
-- ============================================================================
UPDATE user_portfolio_creator_engagement
SET distinct_id = substring(distinct_id FROM 9)
WHERE distinct_id LIKE '$device:%';

-- ============================================================================
-- VERIFICATION: Count remaining $device: prefixes
-- ============================================================================
DO $$
DECLARE
  subscribers_count INT;
  subscribers_v2_count INT;
  retention_count INT;
  event_sequences_count INT;
  creator_engagement_count INT;
  portfolio_engagement_count INT;
BEGIN
  SELECT COUNT(*) INTO subscribers_count FROM subscribers_insights WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO subscribers_v2_count FROM subscribers_insights_v2 WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO retention_count FROM premium_creator_retention_events WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO event_sequences_count FROM event_sequences_raw WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO creator_engagement_count FROM user_creator_engagement WHERE distinct_id LIKE '$device:%';
  SELECT COUNT(*) INTO portfolio_engagement_count FROM user_portfolio_creator_engagement WHERE distinct_id LIKE '$device:%';

  RAISE NOTICE '✅ Cleaned distinct_id columns';
  RAISE NOTICE '  - subscribers_insights: % remaining with $device: prefix', subscribers_count;
  RAISE NOTICE '  - subscribers_insights_v2: % remaining with $device: prefix', subscribers_v2_count;
  RAISE NOTICE '  - premium_creator_retention_events: % remaining with $device: prefix', retention_count;
  RAISE NOTICE '  - event_sequences_raw: % remaining with $device: prefix', event_sequences_count;
  RAISE NOTICE '  - user_creator_engagement: % remaining with $device: prefix', creator_engagement_count;
  RAISE NOTICE '  - user_portfolio_creator_engagement: % remaining with $device: prefix', portfolio_engagement_count;

  IF subscribers_count + subscribers_v2_count + retention_count + event_sequences_count + creator_engagement_count + portfolio_engagement_count > 0 THEN
    RAISE WARNING '⚠️ Some $device: prefixes remain - check for constraint violations or data issues';
  ELSE
    RAISE NOTICE '✓ All $device: prefixes successfully removed';
  END IF;
END $$;
