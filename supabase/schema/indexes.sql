-- Performance Indexes for Engagement Analysis Views
-- These indexes speed up the aggregation queries in the views

-- Indexes for user_portfolio_creator_views (subscriptions)
CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_views_distinct_id
ON user_portfolio_creator_views(distinct_id);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_views_portfolio_creator
ON user_portfolio_creator_views(portfolio_ticker, creator_id);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_views_did_subscribe
ON user_portfolio_creator_views(did_subscribe);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_views_creator
ON user_portfolio_creator_views(creator_id);

-- Indexes for user_portfolio_creator_copies (copies)
CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_copies_distinct_id
ON user_portfolio_creator_copies(distinct_id);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_copies_portfolio_creator
ON user_portfolio_creator_copies(portfolio_ticker, creator_id);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_copies_did_copy
ON user_portfolio_creator_copies(did_copy);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_copies_creator
ON user_portfolio_creator_copies(creator_id);
