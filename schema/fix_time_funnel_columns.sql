-- Fix time funnel columns in main_analysis
-- This script checks if the columns exist and only adds the JOIN if needed
-- SAFE: Does not drop existing data

-- First, let's check what we're working with
-- Run this query to see the current main_analysis structure:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'main_analysis';

-- If main_analysis is a TABLE (not a view), we need to add columns if they don't exist
DO $$
BEGIN
    -- Add time_to_first_copy column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'main_analysis' AND column_name = 'time_to_first_copy') THEN
        ALTER TABLE main_analysis ADD COLUMN time_to_first_copy numeric;
    END IF;

    -- Add time_to_linked_bank column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'main_analysis' AND column_name = 'time_to_linked_bank') THEN
        ALTER TABLE main_analysis ADD COLUMN time_to_linked_bank numeric;
    END IF;

    -- Add time_to_funded_account column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'main_analysis' AND column_name = 'time_to_funded_account') THEN
        ALTER TABLE main_analysis ADD COLUMN time_to_funded_account numeric;
    END IF;
END $$;

-- Now update the main_analysis table with data from time_funnels
-- This populates the NULL values with actual time funnel data
UPDATE main_analysis ma
SET
    time_to_first_copy = tf_first_copy.time_in_days,
    time_to_linked_bank = tf_linked_bank.time_in_days,
    time_to_funded_account = tf_funded.time_in_days
FROM
    (SELECT DISTINCT ON (distinct_id) distinct_id, time_in_days
     FROM time_funnels
     WHERE funnel_type = 'time_to_first_copy'
     ORDER BY distinct_id, synced_at DESC) tf_first_copy,
    (SELECT DISTINCT ON (distinct_id) distinct_id, time_in_days
     FROM time_funnels
     WHERE funnel_type = 'time_to_linked_bank'
     ORDER BY distinct_id, synced_at DESC) tf_linked_bank,
    (SELECT DISTINCT ON (distinct_id) distinct_id, time_in_days
     FROM time_funnels
     WHERE funnel_type = 'time_to_funded_account'
     ORDER BY distinct_id, synced_at DESC) tf_funded
WHERE
    ma."$distinct_id" = tf_first_copy.distinct_id
    OR ma."$distinct_id" = tf_linked_bank.distinct_id
    OR ma."$distinct_id" = tf_funded.distinct_id;

-- Create a function to update time funnel data (can be called after each sync)
CREATE OR REPLACE FUNCTION update_main_analysis_time_funnels()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Update with latest time funnel data
    UPDATE main_analysis ma
    SET
        time_to_first_copy = COALESCE(tf_copy.time_in_days, ma.time_to_first_copy),
        time_to_linked_bank = COALESCE(tf_bank.time_in_days, ma.time_to_linked_bank),
        time_to_funded_account = COALESCE(tf_funded.time_in_days, ma.time_to_funded_account)
    FROM
        (SELECT DISTINCT ON (distinct_id) distinct_id, time_in_days
         FROM time_funnels
         WHERE funnel_type = 'time_to_first_copy'
         ORDER BY distinct_id, synced_at DESC) tf_copy
    FULL OUTER JOIN
        (SELECT DISTINCT ON (distinct_id) distinct_id, time_in_days
         FROM time_funnels
         WHERE funnel_type = 'time_to_linked_bank'
         ORDER BY distinct_id, synced_at DESC) tf_bank
    ON tf_copy.distinct_id = tf_bank.distinct_id
    FULL OUTER JOIN
        (SELECT DISTINCT ON (distinct_id) distinct_id, time_in_days
         FROM time_funnels
         WHERE funnel_type = 'time_to_funded_account'
         ORDER BY distinct_id, synced_at DESC) tf_funded
    ON COALESCE(tf_copy.distinct_id, tf_bank.distinct_id) = tf_funded.distinct_id
    WHERE
        ma."$distinct_id" = COALESCE(tf_copy.distinct_id, tf_bank.distinct_id, tf_funded.distinct_id);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION update_main_analysis_time_funnels() TO authenticated, anon, service_role;

-- Run the function to populate data immediately
SELECT update_main_analysis_time_funnels();
