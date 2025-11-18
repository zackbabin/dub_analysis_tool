-- Add detailed creator information to subscription distribution view
-- This allows us to show top 5 creators per price in chart tooltips

CREATE OR REPLACE VIEW latest_subscription_distribution AS
WITH normalized_prices AS (
    SELECT
        creator_id,
        creator_username,
        subscription_price,
        subscription_interval,
        total_subscriptions,
        total_paywall_views,
        synced_at,
        ROUND(
            CASE
                WHEN subscription_interval = 'Quarterly' THEN subscription_price / 3.0
                WHEN subscription_interval IN ('Annually', 'Annual') THEN subscription_price / 12.0
                ELSE subscription_price
            END,
            2
        ) as monthly_price
    FROM creator_subscriptions_by_price
    WHERE synced_at = (SELECT MAX(synced_at) FROM creator_subscriptions_by_price)
)
SELECT
    monthly_price,
    COUNT(DISTINCT creator_id)::bigint as creator_count,
    SUM(total_subscriptions)::bigint as total_subscriptions,
    SUM(total_paywall_views)::bigint as total_paywall_views,
    array_agg(DISTINCT creator_username ORDER BY creator_username) as creator_usernames,
    -- Add JSON array of top 5 creators by subscription count
    (
        SELECT json_agg(
            json_build_object(
                'username', np2.creator_username,
                'subscriptions', np2.total_subscriptions
            )
            ORDER BY np2.total_subscriptions DESC
        )
        FROM (
            SELECT creator_username, total_subscriptions
            FROM normalized_prices np3
            WHERE np3.monthly_price = np.monthly_price
            ORDER BY total_subscriptions DESC
            LIMIT 5
        ) np2
    ) as top_creators
FROM normalized_prices np
GROUP BY monthly_price
ORDER BY monthly_price;

GRANT SELECT ON latest_subscription_distribution TO anon, authenticated;

COMMENT ON VIEW latest_subscription_distribution IS
'Latest subscription price distribution with top 5 creators per price point. Includes creator subscription counts for hover tooltips in the chart.';
