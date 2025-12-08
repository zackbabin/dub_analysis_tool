-- Migration: Fix premium_creator_metrics primary key
-- Change from id (useless auto-increment) to creator_id as the primary key
-- This aligns with the premium_creators table structure

-- Step 1: Drop the existing primary key constraint on id
ALTER TABLE premium_creator_metrics DROP CONSTRAINT IF EXISTS premium_creator_metrics_pkey;

-- Step 2: Drop the id column (it's useless)
ALTER TABLE premium_creator_metrics DROP COLUMN IF EXISTS id;

-- Step 3: Make creator_id the primary key
ALTER TABLE premium_creator_metrics ADD PRIMARY KEY (creator_id);

-- Note: The UNIQUE constraint on creator_id was already added in migration 20251203_fix_premium_creator_metrics_single_row.sql
-- so we don't need to add it again (PRIMARY KEY implies UNIQUE)
