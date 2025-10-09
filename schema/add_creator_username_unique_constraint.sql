-- Add unique constraint on creator_username for upsert operations
-- This allows us to update existing creator records when uploading CSV data

-- First, check if there are any duplicate creator_usernames
-- If duplicates exist, we'll keep the most recent record
DO $$
BEGIN
    -- Delete older duplicate records, keeping only the most recent
    DELETE FROM creators_insights
    WHERE id IN (
        SELECT id
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY creator_username ORDER BY updated_at DESC NULLS LAST, id DESC) as rn
            FROM creators_insights
            WHERE creator_username IS NOT NULL
        ) t
        WHERE rn > 1
    );
END $$;

-- Add unique constraint on creator_username
ALTER TABLE creators_insights
ADD CONSTRAINT creators_insights_creator_username_key UNIQUE (creator_username);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_creators_insights_creator_username
ON creators_insights(creator_username);

-- Add comment
COMMENT ON CONSTRAINT creators_insights_creator_username_key ON creators_insights IS 'Ensures each creator_username appears only once, enabling upsert operations for CSV uploads';
