-- Create creator_analysis view
-- Merges uploaded_creators (base data) with creators_insights (Mixpanel enrichment)
-- This view provides the complete dataset for correlation analysis

DROP VIEW IF EXISTS creator_analysis;

CREATE OR REPLACE VIEW creator_analysis AS
SELECT
    uc.email,
    uc.creator_username,
    uc.creator_id,
    uc.raw_data,
    -- Mixpanel enrichment columns (from creators_insights)
    ci.total_deposits,
    ci.active_created_portfolios,
    ci.lifetime_created_portfolios,
    ci.total_trades,
    ci.investing_activity,
    ci.investing_experience_years,
    ci.investing_objective,
    ci.investment_type,
    ci.synced_at as mixpanel_synced_at,
    uc.uploaded_at
FROM uploaded_creators uc
LEFT JOIN creators_insights ci
    ON LOWER(TRIM(uc.email)) = LOWER(TRIM(ci.email))
WHERE uc.uploaded_at = (SELECT MAX(uploaded_at) FROM uploaded_creators);

COMMENT ON VIEW creator_analysis IS 'Combines manually uploaded creator data with Mixpanel user profile enrichment data. Shows most recent upload batch only.';

SELECT 'creator_analysis view created successfully' as status;
