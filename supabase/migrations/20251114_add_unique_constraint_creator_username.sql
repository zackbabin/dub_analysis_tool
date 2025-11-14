-- Migration: Add unique constraint on creator_username in premium_creators table
-- This ensures only ONE creator_id per username in the database
-- Handles two deduplication scenarios:
--   1. Same username with multiple creator_ids (e.g., @dubAdvisors: 118 → 211855351476994048)
--   2. Same creator_id with multiple usernames (prefer username with most engagement)

-- Step 1: Handle same creator_id with multiple usernames
-- Keep the username that appears most in user_portfolio_creator_engagement (most engagement)
DO $$
DECLARE
  duplicate_creator_id TEXT;
  kept_username TEXT;
  old_usernames TEXT[];
  old_username TEXT;
BEGIN
  -- Find creator_ids with multiple usernames
  FOR duplicate_creator_id, kept_username, old_usernames IN
    SELECT
      creator_id,
      -- Keep the username with most engagement (most rows in user_portfolio_creator_engagement)
      (SELECT creator_username
       FROM (
         SELECT uce.creator_username, COUNT(*) as engagement_count
         FROM user_portfolio_creator_engagement uce
         WHERE uce.creator_id = pc.creator_id
         GROUP BY uce.creator_username
         ORDER BY engagement_count DESC
         LIMIT 1
       ) sub
      ) as kept_username,
      ARRAY_AGG(creator_username) as all_usernames
    FROM premium_creators pc
    GROUP BY creator_id
    HAVING COUNT(*) > 1
  LOOP
    RAISE NOTICE 'Consolidating creator_id %: usernames [%], keeping %',
      duplicate_creator_id,
      ARRAY_TO_STRING(old_usernames, ', '),
      kept_username;

    -- Update all engagement tables to use the kept username
    FOREACH old_username IN ARRAY old_usernames
    LOOP
      IF old_username != kept_username THEN
        -- Update user_portfolio_creator_engagement
        UPDATE user_portfolio_creator_engagement
        SET creator_username = kept_username
        WHERE creator_id = duplicate_creator_id
          AND creator_username = old_username;

        -- Update user_creator_engagement
        UPDATE user_creator_engagement
        SET creator_username = kept_username
        WHERE creator_id = duplicate_creator_id
          AND creator_username = old_username;

        -- Update portfolio_creator_copy_metrics
        UPDATE portfolio_creator_copy_metrics
        SET creator_username = kept_username
        WHERE creator_id = duplicate_creator_id
          AND creator_username = old_username;

        -- Delete old username from premium_creators
        DELETE FROM premium_creators
        WHERE creator_id = duplicate_creator_id
          AND creator_username = old_username;

        RAISE NOTICE '  ✅ Consolidated % to %', old_username, kept_username;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Step 2: Merge data from duplicate creator_ids (prefer 18-digit IDs)
DO $$
DECLARE
  duplicate_username TEXT;
  kept_creator_id TEXT;
  old_creator_ids TEXT[];
  old_id TEXT;
BEGIN
  -- Find usernames with multiple creator_ids
  FOR duplicate_username, kept_creator_id, old_creator_ids IN
    SELECT
      creator_username,
      -- Keep the 18-digit ID (or longest if none are 18 digits)
      (ARRAY_AGG(creator_id ORDER BY LENGTH(creator_id) DESC, creator_id DESC))[1] as kept_id,
      -- Get all other IDs to merge
      ARRAY_AGG(creator_id ORDER BY LENGTH(creator_id) DESC, creator_id DESC) as all_ids
    FROM premium_creators
    GROUP BY creator_username
    HAVING COUNT(*) > 1
  LOOP
    RAISE NOTICE 'Merging %: IDs [%], keeping %',
      duplicate_username,
      ARRAY_TO_STRING(old_creator_ids, ', '),
      kept_creator_id;

    -- Merge data from old creator_ids to kept_creator_id
    FOREACH old_id IN ARRAY old_creator_ids
    LOOP
      IF old_id != kept_creator_id THEN
        RAISE NOTICE '  Merging data from % to %', old_id, kept_creator_id;

        -- Merge user_portfolio_creator_engagement
        -- First, aggregate data where conflict would occur
        INSERT INTO user_portfolio_creator_engagement
          (distinct_id, portfolio_ticker, creator_id, creator_username, pdp_view_count, did_copy, copy_count, liquidation_count, synced_at)
        SELECT
          distinct_id,
          portfolio_ticker,
          kept_creator_id,
          duplicate_username,
          SUM(pdp_view_count),
          BOOL_OR(did_copy),
          SUM(COALESCE(copy_count, 0)),
          SUM(COALESCE(liquidation_count, 0)),
          MAX(synced_at)
        FROM user_portfolio_creator_engagement
        WHERE (creator_id = old_id OR creator_id = kept_creator_id)
          AND creator_username = duplicate_username
        GROUP BY distinct_id, portfolio_ticker
        ON CONFLICT (distinct_id, portfolio_ticker, creator_id) DO UPDATE SET
          pdp_view_count = EXCLUDED.pdp_view_count,
          did_copy = EXCLUDED.did_copy,
          copy_count = EXCLUDED.copy_count,
          liquidation_count = EXCLUDED.liquidation_count,
          synced_at = EXCLUDED.synced_at;

        -- Delete old_id rows (kept_creator_id rows were handled by INSERT ON CONFLICT)
        DELETE FROM user_portfolio_creator_engagement
        WHERE creator_id = old_id
          AND creator_username = duplicate_username;

        -- Merge user_creator_engagement
        INSERT INTO user_creator_engagement
          (distinct_id, creator_id, creator_username, profile_view_count, did_subscribe, subscription_count, synced_at)
        SELECT
          distinct_id,
          kept_creator_id,
          duplicate_username,
          SUM(profile_view_count),
          BOOL_OR(did_subscribe),
          SUM(subscription_count),
          MAX(synced_at)
        FROM user_creator_engagement
        WHERE (creator_id = old_id OR creator_id = kept_creator_id)
          AND creator_username = duplicate_username
        GROUP BY distinct_id
        ON CONFLICT (distinct_id, creator_id) DO UPDATE SET
          profile_view_count = EXCLUDED.profile_view_count,
          did_subscribe = EXCLUDED.did_subscribe,
          subscription_count = EXCLUDED.subscription_count,
          synced_at = EXCLUDED.synced_at;

        -- Delete old_id rows
        DELETE FROM user_creator_engagement
        WHERE creator_id = old_id
          AND creator_username = duplicate_username;

        -- Merge portfolio_creator_copy_metrics
        INSERT INTO portfolio_creator_copy_metrics
          (portfolio_ticker, creator_id, creator_username, total_copies, total_liquidations, synced_at)
        SELECT
          portfolio_ticker,
          kept_creator_id,
          duplicate_username,
          SUM(total_copies),
          SUM(total_liquidations),
          MAX(synced_at)
        FROM portfolio_creator_copy_metrics
        WHERE (creator_id = old_id OR creator_id = kept_creator_id)
          AND creator_username = duplicate_username
        GROUP BY portfolio_ticker
        ON CONFLICT (portfolio_ticker, creator_id) DO UPDATE SET
          total_copies = EXCLUDED.total_copies,
          total_liquidations = EXCLUDED.total_liquidations,
          synced_at = EXCLUDED.synced_at;

        -- Delete old_id rows
        DELETE FROM portfolio_creator_copy_metrics
        WHERE creator_id = old_id
          AND creator_username = duplicate_username;

        -- Update premium_creator_metrics (just change creator_id, don't merge since synced_at makes them unique)
        UPDATE premium_creator_metrics
        SET creator_id = kept_creator_id
        WHERE creator_id = old_id;

        -- Delete old creator_id from premium_creators
        DELETE FROM premium_creators
        WHERE creator_id = old_id
          AND creator_username = duplicate_username;

        RAISE NOTICE '  ✅ Merged % into %', old_id, kept_creator_id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Step 3: Add unique constraint on creator_username
ALTER TABLE premium_creators
ADD CONSTRAINT premium_creators_username_unique UNIQUE (creator_username);

COMMENT ON CONSTRAINT premium_creators_username_unique ON premium_creators IS
'Ensures only one creator_id per username. If a creator has multiple IDs in Mixpanel, we keep the 18-digit ID.';

-- Step 4: Verify results
SELECT
  'After deduplication' as status,
  COUNT(*) as total_rows,
  COUNT(DISTINCT creator_username) as unique_usernames,
  COUNT(*) - COUNT(DISTINCT creator_username) as duplicates_remaining
FROM premium_creators;
