-- Migration: Drop old premium_creator_copy_affinity_computed table
-- Description: Remove the computed table now that we use views instead
-- IMPORTANT: Only run this AFTER verifying the views work correctly in production

-- Drop the old computed table
DROP TABLE IF EXISTS premium_creator_copy_affinity_computed CASCADE;

-- Note: This will also drop any indexes, triggers, or other objects that depend on this table
