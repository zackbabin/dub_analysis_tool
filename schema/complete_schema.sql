-- Complete Database Schema for Dub Analysis Tool
-- This file documents all tables and views in the database

-- ============================================================================
-- BASE TABLES
-- ============================================================================

-- Table: conversion_pattern_combinations
-- Stores results from exhaustive search + logistic regression analysis
CREATE TABLE IF NOT EXISTS conversion_pattern_combinations (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    analysis_type text,
    combination_rank integer,
    value_1 text,
    value_2 text,
    value_3 text,
    log_likelihood numeric,
    aic numeric,
    odds_ratio numeric,
    precision numeric,
    recall numeric,
    lift numeric,
    users_with_exposure integer,
    conversion_rate_in_group numeric,
    overall_conversion_rate numeric,
    analyzed_at timestamp with time zone
);

-- Table: creator_subscriptions_by_price
-- Creator-level subscription data with price and engagement metrics
-- Each creator can have multiple price points and intervals
CREATE TABLE IF NOT EXISTS creator_subscriptions_by_price (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    creator_id text NOT NULL,
    creator_username text,
    subscription_price numeric,
    subscription_interval text,
    total_subscriptions integer,
    total_paywall_views integer,
    synced_at timestamp with time zone,
    UNIQUE(creator_id, subscription_price, subscription_interval, synced_at)
);

-- Table: creators_insights
-- Creator-level metrics and analytics
-- Uses JSONB for flexible metric storage to accommodate new Mixpanel metrics
CREATE TABLE IF NOT EXISTS creators_insights (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    creator_id text NOT NULL,
    creator_username text,
    creator_type text,
    metrics jsonb DEFAULT '{}'::jsonb,
    -- Legacy columns maintained for backward compatibility
    total_profile_views integer,
    total_pdp_views integer,
    total_paywall_views integer,
    total_stripe_views integer,
    total_subscriptions integer,
    total_subscription_revenue numeric,
    total_cancelled_subscriptions integer,
    total_expired_subscriptions integer,
    total_copies integer,
    total_investment_count integer,
    total_investments numeric,
    synced_at timestamp with time zone,
    updated_at timestamp with time zone
);

-- Table: subscribers_insights
-- User-level behavioral and demographic data
CREATE TABLE IF NOT EXISTS subscribers_insights (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    distinct_id text NOT NULL,
    income text,
    net_worth text,
    investing_activity text,
    investing_experience_years text,
    investing_objective text,
    investment_type text,
    acquisition_survey text,
    linked_bank_account boolean,
    available_copy_credits numeric,
    buying_power numeric,
    total_deposits numeric,
    total_deposit_count integer,
    total_withdrawals numeric,
    total_withdrawal_count integer,
    active_created_portfolios integer,
    lifetime_created_portfolios integer,
    total_copies integer,
    total_regular_copies integer,
    total_premium_copies integer,
    regular_pdp_views integer,
    premium_pdp_views integer,
    paywall_views integer,
    regular_creator_profile_views integer,
    premium_creator_profile_views integer,
    stripe_modal_views integer,
    app_sessions integer,
    discover_tab_views integer,
    leaderboard_tab_views integer,
    premium_tab_views integer,
    creator_card_taps integer,
    portfolio_card_taps integer,
    total_subscriptions integer,
    subscribed_within_7_days boolean,
    synced_at timestamp with time zone,
    updated_at timestamp with time zone
);

-- Table: sync_logs
-- Audit log for all sync operations
CREATE TABLE IF NOT EXISTS sync_logs (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    sync_started_at timestamp with time zone NOT NULL,
    sync_completed_at timestamp with time zone,
    sync_status text NOT NULL,
    source text,
    triggered_by text,
    subscribers_fetched integer,
    time_funnels_fetched integer,
    total_records_inserted integer,
    error_message text,
    error_details jsonb,
    duration_seconds numeric,
    created_at timestamp with time zone,
    tool_type text
);

-- Table: time_funnels
-- Time-to-conversion funnel metrics
CREATE TABLE IF NOT EXISTS time_funnels (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    distinct_id text NOT NULL,
    funnel_type text NOT NULL,
    time_in_seconds numeric,
    time_in_days numeric,
    synced_at timestamp with time zone
);

-- Table: user_portfolio_creator_copies
-- Raw data: user interactions with portfolios (copy behavior)
CREATE TABLE IF NOT EXISTS user_portfolio_creator_copies (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    distinct_id text NOT NULL,
    portfolio_ticker text NOT NULL,
    creator_id text NOT NULL,
    creator_username text,
    pdp_view_count integer NOT NULL,
    did_copy boolean NOT NULL,
    synced_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    profile_view_count integer
);

-- Table: user_portfolio_creator_views
-- Raw data: user interactions with portfolios (subscription behavior)
CREATE TABLE IF NOT EXISTS user_portfolio_creator_views (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    distinct_id text NOT NULL,
    portfolio_ticker text NOT NULL,
    creator_id text NOT NULL,
    creator_username text,
    pdp_view_count integer,
    did_subscribe boolean,
    synced_at timestamp with time zone,
    profile_view_count integer
);

-- ============================================================================
-- VIEWS (Regular)
-- ============================================================================

-- View: creator_profile_view_metrics
-- Aggregates profile views by creator
CREATE OR REPLACE VIEW creator_profile_view_metrics AS
SELECT
    creator_id,
    COUNT(DISTINCT distinct_id) as total_profile_views
FROM user_portfolio_creator_copies
GROUP BY creator_id;

-- View: hidden_gems_summary
-- Summary statistics for hidden gems analysis
CREATE OR REPLACE VIEW hidden_gems_summary AS
SELECT
    COUNT(*) as total_hidden_gems,
    ROUND(AVG(total_pdp_views), 1) as avg_pdp_views,
    ROUND(AVG(conversion_rate_pct), 2) as avg_conversion_rate
FROM hidden_gems_portfolios;

-- View: latest_subscription_distribution
-- Most recent subscription price distribution
CREATE OR REPLACE VIEW latest_subscription_distribution AS
SELECT
    subscription_price as monthly_price,
    SUM(total_subscriptions)::bigint as total_subscriptions,
    SUM(total_paywall_views)::bigint as total_paywall_views,
    array_agg(creator_username ORDER BY creator_username) as creator_usernames
FROM creator_subscriptions_by_price
WHERE synced_at = (SELECT MAX(synced_at) FROM creator_subscriptions_by_price)
GROUP BY subscription_price
ORDER BY subscription_price;

-- View: latest_sync_status
-- Most recent sync status by tool type
CREATE OR REPLACE VIEW latest_sync_status AS
SELECT DISTINCT ON (tool_type)
    tool_type,
    sync_started_at,
    sync_completed_at,
    sync_status,
    subscribers_fetched,
    time_funnels_fetched,
    total_records_inserted,
    duration_seconds,
    error_message
FROM sync_logs
ORDER BY tool_type, sync_started_at DESC;

-- ============================================================================
-- MATERIALIZED VIEWS
-- ============================================================================
-- Note: These are defined in separate schema files:
-- - subscription_pairs_views.sql: subscription_engagement_summary
-- - copy_pairs_views.sql: copy_engagement_summary, portfolio_creator_engagement_metrics
-- - hidden_gems_view.sql: hidden_gems_portfolios
-- - main_analysis materialized view (if exists)
