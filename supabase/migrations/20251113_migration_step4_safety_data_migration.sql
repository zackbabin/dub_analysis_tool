-- Migration Step 4: Safety Data Migration
-- Copy any records from subscribers_insights that don't exist in subscribers_insights_v2
-- This is a safety measure for any data synced to v1 after v2 was created

-- First, check how many records need to be migrated
SELECT
  COUNT(*) as records_to_migrate,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No migration needed - all v1 records exist in v2'
    WHEN COUNT(*) < 100 THEN '⚠️ Small migration needed'
    ELSE '❌ Large migration needed - investigate'
  END as status
FROM subscribers_insights v1
LEFT JOIN subscribers_insights_v2 v2 ON v1.distinct_id = v2.distinct_id
WHERE v2.distinct_id IS NULL;

-- Perform the migration (only inserts records that don't exist in v2)
INSERT INTO subscribers_insights_v2 (
  distinct_id,
  income,
  net_worth,
  investing_activity,
  investing_experience_years,
  investing_objective,
  investment_type,
  acquisition_survey,
  linked_bank_account,
  available_copy_credits,
  buying_power,
  total_deposits,
  total_deposit_count,
  total_withdrawals,
  total_withdrawal_count,
  active_created_portfolios,
  lifetime_created_portfolios,
  total_copies,
  total_regular_copies,
  total_premium_copies,
  regular_pdp_views,
  premium_pdp_views,
  paywall_views,
  regular_creator_profile_views,
  premium_creator_profile_views,
  total_subscriptions,
  stripe_modal_views,
  app_sessions,
  creator_card_taps,
  portfolio_card_taps,
  synced_at,
  updated_at
)
SELECT
  v1.distinct_id,
  v1.income,
  v1.net_worth,
  v1.investing_activity,
  v1.investing_experience_years,
  v1.investing_objective,
  v1.investment_type,
  v1.acquisition_survey,
  v1.linked_bank_account,
  v1.available_copy_credits,
  v1.buying_power,
  v1.total_deposits,
  v1.total_deposit_count,
  v1.total_withdrawals,
  v1.total_withdrawal_count,
  v1.active_created_portfolios,
  v1.lifetime_created_portfolios,
  v1.total_copies,
  v1.total_regular_copies,
  v1.total_premium_copies,
  v1.regular_pdp_views,
  v1.premium_pdp_views,
  v1.paywall_views,
  v1.regular_creator_profile_views,
  v1.premium_creator_profile_views,
  v1.total_subscriptions,
  v1.stripe_modal_views,
  v1.app_sessions,
  v1.creator_card_taps,
  v1.portfolio_card_taps,
  v1.synced_at,
  v1.updated_at
FROM subscribers_insights v1
LEFT JOIN subscribers_insights_v2 v2 ON v1.distinct_id = v2.distinct_id
WHERE v2.distinct_id IS NULL
ON CONFLICT (distinct_id) DO NOTHING;

-- Verify migration completed
SELECT
  'Migration Complete' as status,
  COUNT(*) as records_migrated
FROM subscribers_insights v1
LEFT JOIN subscribers_insights_v2 v2 ON v1.distinct_id = v2.distinct_id
WHERE v2.distinct_id IS NULL;

-- Final verification: row counts should now match (or v2 should have more due to backfill)
SELECT
  'subscribers_insights' as table_name,
  COUNT(*) as total_rows
FROM subscribers_insights

UNION ALL

SELECT
  'subscribers_insights_v2' as table_name,
  COUNT(*) as total_rows
FROM subscribers_insights_v2;
