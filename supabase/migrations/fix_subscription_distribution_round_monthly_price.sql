-- Fix subscription price distribution to round monthly prices to 2 decimal places
-- Problem: Division for quarterly/annual creates many decimal places (e.g., 8.333333...)
--          causing multiple bars instead of one grouped bar
-- Solution: Round monthly_price to 2 decimal places in CASE statement
-- Date: 2025-11-12

CREATE OR REPLACE VIEW latest_subscription_distribution AS
SELECT
    ROUND(
        CASE
            WHEN subscription_interval = 'Quarterly' THEN subscription_price / 3.0
            WHEN subscription_interval IN ('Annually', 'Annual') THEN subscription_price / 12.0
            ELSE subscription_price
        END,
        2
    ) as monthly_price,
    COUNT(DISTINCT creator_id)::bigint as creator_count,
    SUM(total_subscriptions)::bigint as total_subscriptions,
    SUM(total_paywall_views)::bigint as total_paywall_views,
    array_agg(DISTINCT creator_username ORDER BY creator_username) as creator_usernames
FROM creator_subscriptions_by_price
WHERE synced_at = (SELECT MAX(synced_at) FROM creator_subscriptions_by_price)
GROUP BY monthly_price
ORDER BY monthly_price;

GRANT SELECT ON latest_subscription_distribution TO anon, authenticated;

COMMENT ON VIEW latest_subscription_distribution IS
'Latest subscription price distribution normalized to monthly prices. Rounds to 2 decimal places to group similar prices (e.g., all $8.33 quarterly subscriptions grouped together).';
