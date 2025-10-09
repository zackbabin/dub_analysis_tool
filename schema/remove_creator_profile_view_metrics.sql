-- Remove unused creator_profile_view_metrics view
-- This view is not used in the current Hidden Gems analysis

DROP VIEW IF EXISTS creator_profile_view_metrics CASCADE;

SELECT 'creator_profile_view_metrics view removed' as status;
