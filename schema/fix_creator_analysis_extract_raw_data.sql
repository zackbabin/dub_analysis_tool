-- Fix creator_analysis view to pass through raw_data JSONB
-- The JavaScript correlation analysis will extract fields dynamically from raw_data

DROP VIEW IF EXISTS creator_analysis CASCADE;

CREATE OR REPLACE VIEW creator_analysis AS
SELECT
    creator_id,
    creator_username,
    'Regular'::text as creator_type,

    -- Enriched metrics from creators_insights (via LEFT JOIN in upload function)
    total_copies,
    total_subscriptions,

    -- Pass through raw_data JSONB containing all CSV columns
    -- The correlation analysis will extract numeric fields dynamically
    raw_data
FROM uploaded_creators
WHERE uploaded_at = (SELECT MAX(uploaded_at) FROM uploaded_creators);

SELECT 'creator_analysis view updated to pass through raw_data JSONB' as status;
