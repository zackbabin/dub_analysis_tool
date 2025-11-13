


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'Dropped latest_sync_status view - unused legacy code. Using sync_logs directly for timestamps.';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."calculate_sync_duration"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.sync_completed_at IS NOT NULL AND OLD.sync_completed_at IS NULL THEN
        NEW.duration_seconds = EXTRACT(EPOCH FROM (NEW.sync_completed_at - NEW.sync_started_at));
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calculate_sync_duration"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_single_marketing_metrics_row"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    DELETE FROM public.marketing_metrics;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_single_marketing_metrics_row"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ensure_single_marketing_metrics_row"() IS 'Ensures only one row exists in marketing_metrics table by deleting all rows before insert. Uses SECURITY DEFINER to bypass RLS.';



CREATE OR REPLACE FUNCTION "public"."get_distinct_creator_usernames"("creator_ids" "text"[]) RETURNS TABLE("creator_id" "text", "creator_username" "text")
    LANGUAGE "plpgsql"
    AS $$
  BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (upcv.creator_id)
      upcv.creator_id::TEXT,
      upcv.creator_username::TEXT
    FROM user_portfolio_creator_views upcv
    WHERE upcv.creator_id = ANY(creator_ids)
      AND upcv.creator_username IS NOT NULL
      AND upcv.creator_username != ''
    ORDER BY upcv.creator_id;
  END;
  $$;


ALTER FUNCTION "public"."get_distinct_creator_usernames"("creator_ids" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_last_portfolio_event_timestamp"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  last_event_time bigint;
BEGIN
  SELECT MAX(event_time) INTO last_event_time
  FROM portfolio_view_events;

  RETURN last_event_time;
END;
$$;


ALTER FUNCTION "public"."get_last_portfolio_event_timestamp"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_last_portfolio_event_timestamp"() IS 'Returns the most recent event_time (Unix timestamp) from portfolio_view_events table.
Used by sync-mixpanel-portfolio-events to determine the starting point for incremental sync.
Returns NULL if no events exist, triggering a full sync.';



CREATE OR REPLACE FUNCTION "public"."get_last_successful_sync_time"("source_name" "text") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  last_sync_time timestamp with time zone;
BEGIN
  SELECT MAX(sync_completed_at) INTO last_sync_time
  FROM sync_logs
  WHERE source = source_name
    AND sync_status = 'completed';

  RETURN last_sync_time;
END;
$$;


ALTER FUNCTION "public"."get_last_successful_sync_time"("source_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_last_successful_sync_time"("source_name" "text") IS 'Returns the timestamp of the last successful sync for a given source.
Used to implement incremental sync logic and fallback strategies.';



CREATE OR REPLACE FUNCTION "public"."log_materialized_view_refresh"("p_view_name" "text", "p_refresh_duration_ms" integer DEFAULT NULL::integer, "p_rows_affected" bigint DEFAULT NULL::bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO materialized_view_refresh_log (view_name, last_refreshed_at, refresh_duration_ms, rows_affected)
  VALUES (p_view_name, NOW(), p_refresh_duration_ms, p_rows_affected)
  ON CONFLICT (view_name)
  DO UPDATE SET
    last_refreshed_at = NOW(),
    refresh_duration_ms = COALESCE(EXCLUDED.refresh_duration_ms, materialized_view_refresh_log.refresh_duration_ms),
    rows_affected = COALESCE(EXCLUDED.rows_affected, materialized_view_refresh_log.rows_affected);
END;
$$;


ALTER FUNCTION "public"."log_materialized_view_refresh"("p_view_name" "text", "p_refresh_duration_ms" integer, "p_rows_affected" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_materialized_view_refresh"("p_view_name" "text", "p_refresh_duration_ms" integer, "p_rows_affected" bigint) IS 'Helper function to log when a materialized view was refreshed. Call this after refreshing any materialized view.';



CREATE OR REPLACE FUNCTION "public"."refresh_all_premium_creator_views"() RETURNS TABLE("view_name" "text", "status" "text", "duration_ms" integer, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
  v_duration_ms INTEGER;
  v_error_msg TEXT;
BEGIN
  -- This function refreshes views in dependency order:
  -- Level 1 (base): portfolio_creator_engagement_metrics
  -- Level 2 (depends on L1): premium_creator_breakdown, premium_creator_stock_holdings
  -- Level 3 (depends on L2): premium_creator_summary_stats (view, not MV), top_stocks_all_premium_creators, premium_creator_top_5_stocks

  RAISE NOTICE 'Starting orchestrated refresh of all premium creator views...';

  -- LEVEL 1: Base materialized views

  -- 1. portfolio_creator_engagement_metrics
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_portfolio_creator_engagement_metrics();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'portfolio_creator_engagement_metrics'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ portfolio_creator_engagement_metrics refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'portfolio_creator_engagement_metrics'::TEXT,
      'error'::TEXT,
      NULL::INTEGER,
      v_error_msg;
    RAISE WARNING '✗ portfolio_creator_engagement_metrics failed: %', v_error_msg;
  END;

  -- LEVEL 2: Views that depend on portfolio_creator_engagement_metrics

  -- 2. premium_creator_breakdown
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_premium_creator_breakdown_view();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'premium_creator_breakdown'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ premium_creator_breakdown refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'premium_creator_breakdown'::TEXT,
      'error'::TEXT,
      NULL::INTEGER,
      v_error_msg;
    RAISE WARNING '✗ premium_creator_breakdown failed: %', v_error_msg;
  END;

  -- 3. premium_creator_stock_holdings
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_premium_creator_stock_holdings_view();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'premium_creator_stock_holdings'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ premium_creator_stock_holdings refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'premium_creator_stock_holdings'::TEXT,
      'error'::TEXT,
      NULL::INTEGER,
      v_error_msg;
    RAISE WARNING '✗ premium_creator_stock_holdings failed: %', v_error_msg;
  END;

  -- LEVEL 3: Views that depend on Level 2

  -- 4. top_stocks_all_premium_creators
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_top_stocks_all_premium_creators_view();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'top_stocks_all_premium_creators'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ top_stocks_all_premium_creators refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'top_stocks_all_premium_creators'::TEXT,
      'error'::TEXT,
      NULL::INTEGER,
      v_error_msg;
    RAISE WARNING '✗ top_stocks_all_premium_creators failed: %', v_error_msg;
  END;

  -- 5. premium_creator_top_5_stocks
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_premium_creator_top_5_stocks_view();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'premium_creator_top_5_stocks'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ premium_creator_top_5_stocks refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'premium_creator_top_5_stocks'::TEXT,
      'error'::TEXT,
      NULL::INTEGER,
      v_error_msg;
    RAISE WARNING '✗ premium_creator_top_5_stocks failed: %', v_error_msg;
  END;

  -- Optional: Other materialized views (only if they exist)

  -- 6. hidden_gems_portfolios (optional)
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_hidden_gems_portfolios();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'hidden_gems_portfolios'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ hidden_gems_portfolios refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'hidden_gems_portfolios'::TEXT,
      'skipped'::TEXT,
      NULL::INTEGER,
      'View does not exist'::TEXT;
    RAISE NOTICE '- hidden_gems_portfolios skipped (does not exist)';
  END;

  -- 7. portfolio_breakdown_with_metrics (optional)
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_portfolio_breakdown_view();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'portfolio_breakdown_with_metrics'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ portfolio_breakdown_with_metrics refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'portfolio_breakdown_with_metrics'::TEXT,
      'skipped'::TEXT,
      NULL::INTEGER,
      'View does not exist'::TEXT;
    RAISE NOTICE '- portfolio_breakdown_with_metrics skipped (does not exist)';
  END;

  RAISE NOTICE 'Orchestrated refresh complete!';
END;
$$;


ALTER FUNCTION "public"."refresh_all_premium_creator_views"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_all_premium_creator_views"() IS 'Orchestrated refresh of all premium creator materialized views in correct dependency order. Returns table with status of each refresh. Safe to call - will not fail if individual views fail, and will not modify existing data.';



CREATE OR REPLACE FUNCTION "public"."refresh_copy_engagement_summary"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
  BEGIN
    REFRESH MATERIALIZED VIEW copy_engagement_summary;
  END;
  $$;


ALTER FUNCTION "public"."refresh_copy_engagement_summary"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_copy_engagement_summary"() IS 'Refresh the 
  copy_engagement_summary materialized view';



CREATE OR REPLACE FUNCTION "public"."refresh_creator_analysis"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY creator_analysis;
END;
$$;


ALTER FUNCTION "public"."refresh_creator_analysis"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_hidden_gems"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY portfolio_creator_engagement_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY hidden_gems_portfolios;
END;
$$;


ALTER FUNCTION "public"."refresh_hidden_gems"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_hidden_gems_portfolios"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW hidden_gems_portfolios;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('hidden_gems_portfolios', duration_ms, NULL);
END;
$$;


ALTER FUNCTION "public"."refresh_hidden_gems_portfolios"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_latest_sync_status"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
  BEGIN
      REFRESH MATERIALIZED VIEW latest_sync_status_mv;
  END;
  $$;


ALTER FUNCTION "public"."refresh_latest_sync_status"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_latest_sync_status"() IS 'Helper function to 
  refresh latest_sync_status materialized view. Called by Edge Functions 
  after sync completion.';



CREATE OR REPLACE FUNCTION "public"."refresh_main_analysis"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW main_analysis;
END;
$$;


ALTER FUNCTION "public"."refresh_main_analysis"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_portfolio_breakdown_view"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW portfolio_breakdown_with_metrics;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('portfolio_breakdown_with_metrics', duration_ms, NULL);
END;
$$;


ALTER FUNCTION "public"."refresh_portfolio_breakdown_view"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_portfolio_creator_engagement_metrics"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('portfolio_creator_engagement_metrics', duration_ms, NULL);
END;
$$;


ALTER FUNCTION "public"."refresh_portfolio_creator_engagement_metrics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_portfolio_engagement_views"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Use non-CONCURRENT refresh (brief lock but guaranteed to work)
  -- portfolio_creator_engagement_metrics depends on user_portfolio_creator_engagement
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;

  -- hidden_gems_portfolios depends on portfolio_creator_engagement_metrics
  REFRESH MATERIALIZED VIEW hidden_gems_portfolios;

  -- Note: premium_creator_breakdown is now a regular view (not materialized)
  -- so it doesn't need to be refreshed - it always shows current data

  RETURN 'Successfully refreshed portfolio engagement views';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;


ALTER FUNCTION "public"."refresh_portfolio_engagement_views"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_portfolio_engagement_views"() IS 'Refreshes portfolio_creator_engagement_metrics and hidden_gems_portfolios materialized views. premium_creator_breakdown is now a regular view and updates automatically. Uses non-CONCURRENT refresh for reliability. Called by refresh-engagement-views and sync-creator-data Edge Functions.';



CREATE OR REPLACE FUNCTION "public"."refresh_premium_creator_breakdown_view"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW premium_creator_breakdown;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('premium_creator_breakdown', duration_ms, NULL);
END;
$$;


ALTER FUNCTION "public"."refresh_premium_creator_breakdown_view"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_premium_creator_stock_holdings_view"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW premium_creator_stock_holdings;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('premium_creator_stock_holdings', duration_ms, NULL);
END;
$$;


ALTER FUNCTION "public"."refresh_premium_creator_stock_holdings_view"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_premium_creator_stock_holdings_view"() IS 'Refreshes the premium_creator_stock_holdings materialized view. Call 
  after uploading portfolio stock holdings data.';



CREATE OR REPLACE FUNCTION "public"."refresh_premium_creator_top_5_stocks_view"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW premium_creator_top_5_stocks;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('premium_creator_top_5_stocks', duration_ms, NULL);
END;
$$;


ALTER FUNCTION "public"."refresh_premium_creator_top_5_stocks_view"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_premium_creator_top_5_stocks_view"() IS 'Refreshes the premium_creator_top_5_stocks materialized view. Call after 
  uploading portfolio stock holdings data.';



CREATE OR REPLACE FUNCTION "public"."refresh_premium_creator_views_json"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_results JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(r))
  INTO v_results
  FROM refresh_all_premium_creator_views() r;

  RETURN v_results;
END;
$$;


ALTER FUNCTION "public"."refresh_premium_creator_views_json"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_premium_creator_views_json"() IS 'Returns refresh results as JSON for easy consumption by Edge Functions. Call this after syncing creator data.';



CREATE OR REPLACE FUNCTION "public"."refresh_subscription_engagement_summary"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
  BEGIN
    REFRESH MATERIALIZED VIEW subscription_engagement_summary;
  END;
  $$;


ALTER FUNCTION "public"."refresh_subscription_engagement_summary"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_subscription_engagement_summary"() IS 'Refresh the 
  subscription_engagement_summary materialized view';



CREATE OR REPLACE FUNCTION "public"."refresh_top_stocks_all_premium_creators_view"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW top_stocks_all_premium_creators;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('top_stocks_all_premium_creators', duration_ms, NULL);
END;
$$;


ALTER FUNCTION "public"."refresh_top_stocks_all_premium_creators_view"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_top_stocks_all_premium_creators_view"() IS 'Refreshes the top_stocks_all_premium_creators materialized view. Call 
  after uploading portfolio stock holdings data.';



CREATE OR REPLACE FUNCTION "public"."run_all_validations"() RETURNS TABLE("validation_name" "text", "discrepancy_count" bigint, "status" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    'Liquidations (Breakdown vs Affinity)'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN '✅ All Match' ELSE '⚠️ Discrepancies Found' END
  FROM validation_liquidations_comparison;

  RETURN QUERY
  SELECT
    'Copies (Breakdown vs Affinity)'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN '✅ All Match' ELSE '⚠️ Discrepancies Found' END
  FROM validation_copies_comparison;

  RETURN QUERY
  SELECT
    'Duplicate Creator IDs'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN '✅ No Duplicates' ELSE 'ℹ️ Duplicates Found' END
  FROM validation_duplicate_creator_ids;

  RETURN QUERY
  SELECT
    'Subscription Consistency'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN '✅ All Consistent' ELSE '⚠️ Inconsistencies Found' END
  FROM validation_subscription_consistency
  WHERE status = 'INCONSISTENT';

  RETURN QUERY
  SELECT
    'View Freshness (>1 day old)'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN '✅ All Fresh' ELSE '⚠️ Stale Views Found' END
  FROM validation_view_freshness
  WHERE days_since_refresh > 1;

  RETURN QUERY
  SELECT
    'Aggregated vs User-Level'::TEXT,
    COUNT(*)::BIGINT,
    CASE WHEN COUNT(*) = 0 THEN '✅ All Match' ELSE '⚠️ Discrepancies Found' END
  FROM validation_aggregated_vs_user_level;
END;
$$;


ALTER FUNCTION "public"."run_all_validations"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."run_all_validations"() IS 'Runs all validation queries and returns summary of discrepancies across all data validation views.';



CREATE OR REPLACE FUNCTION "public"."update_creators_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_creators_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
  BEGIN
     NEW.updated_at = NOW();
     RETURN NEW;
  END;
  $$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upload_creator_data"("creator_data" "jsonb"[]) RETURNS TABLE("creator_id" "text", "creator_username" "text", "raw_data" "jsonb", "total_copies" integer, "total_subscriptions" integer)
    LANGUAGE "plpgsql"
    AS $$
  BEGIN
    RETURN QUERY
    WITH uploaded AS (
      SELECT
        (data->>'creator_id')::text as creator_id,
        (data->>'creator_username')::text as creator_username,
        (data->'raw_data')::jsonb as raw_data
      FROM unnest(creator_data) as data
    )
    SELECT
      uploaded.creator_id,
      uploaded.creator_username,
      uploaded.raw_data,
      COALESCE(existing.total_copies, 0)::integer as total_copies,
      COALESCE(existing.total_subscriptions, 0)::integer as
  total_subscriptions
    FROM uploaded
    LEFT JOIN creators_insights existing
      ON LTRIM(uploaded.creator_username, '@') =
  LTRIM(existing.creator_username, '@');
  END;
  $$;


ALTER FUNCTION "public"."upload_creator_data"("creator_data" "jsonb"[]) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."business_assumptions" (
    "id" integer DEFAULT 1 NOT NULL,
    "total_rebalances" numeric NOT NULL,
    "trades_per_user" numeric NOT NULL,
    "portfolios_created_per_user" numeric NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kyc_to_linked_bank" numeric(5,2),
    "linked_bank_to_ach" numeric(5,2),
    "ach_to_copy" numeric(5,2),
    CONSTRAINT "single_row" CHECK (("id" = 1))
);


ALTER TABLE "public"."business_assumptions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."business_assumptions"."total_rebalances" IS 'Average of "A.
   Total Rebalances" metric from Mixpanel (not per-user average)';



COMMENT ON COLUMN "public"."business_assumptions"."kyc_to_linked_bank" IS 'Conversion 
  rate from Approved KYC to Linked Bank Account (percentage)';



COMMENT ON COLUMN "public"."business_assumptions"."linked_bank_to_ach" IS 'Conversion 
  rate from Linked Bank Account to Initiated ACH Transfer (percentage)';



COMMENT ON COLUMN "public"."business_assumptions"."ach_to_copy" IS 'Conversion rate from 
  Initiated ACH Transfer to Copied Portfolio (percentage)';



CREATE TABLE IF NOT EXISTS "public"."conversion_pattern_combinations" (
    "id" bigint NOT NULL,
    "analysis_type" "text",
    "combination_rank" integer,
    "value_1" "text",
    "value_2" "text",
    "lift" numeric,
    "users_with_exposure" integer,
    "conversion_rate_in_group" numeric,
    "overall_conversion_rate" numeric,
    "analyzed_at" timestamp with time zone,
    "total_conversions" integer,
    "username_1" "text",
    "username_2" "text",
    "total_views_1" integer,
    "total_views_2" integer,
    "log_likelihood" numeric,
    "aic" numeric,
    "odds_ratio" numeric,
    "precision" numeric,
    "recall" numeric
);


ALTER TABLE "public"."conversion_pattern_combinations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."conversion_pattern_combinations"."total_conversions" IS 'Total number of conversions from users exposed to this combination';



COMMENT ON COLUMN "public"."conversion_pattern_combinations"."username_1" IS 'Creator username for creator_copy analysis, portfolio ticker for copy analysis';



COMMENT ON COLUMN "public"."conversion_pattern_combinations"."username_2" IS 'Creator username for creator_copy analysis, portfolio ticker for copy analysis';



COMMENT ON COLUMN "public"."conversion_pattern_combinations"."total_views_1" IS 'Total views for entity 1 (profile views for creators, PDP views for portfolios)';



COMMENT ON COLUMN "public"."conversion_pattern_combinations"."total_views_2" IS 'Total views for entity 2 (profile views for creators, PDP views for portfolios)';



COMMENT ON COLUMN "public"."conversion_pattern_combinations"."log_likelihood" IS 'Log-likelihood from logistic regression model';



COMMENT ON COLUMN "public"."conversion_pattern_combinations"."aic" IS 'Akaike 
  Information Criterion - model fit metric (lower is better)';



COMMENT ON COLUMN "public"."conversion_pattern_combinations"."odds_ratio" IS 'Odds 
  ratio from logistic regression (exp(beta1))';



COMMENT ON COLUMN "public"."conversion_pattern_combinations"."precision" IS 'Precision 
  metric: true positives / (true positives + false positives)';



COMMENT ON COLUMN "public"."conversion_pattern_combinations"."recall" IS 'Recall 
  metric: true positives / (true positives + false negatives)';



CREATE SEQUENCE IF NOT EXISTS "public"."conversion_pattern_combinations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."conversion_pattern_combinations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."conversion_pattern_combinations_id_seq" OWNED BY "public"."conversion_pattern_combinations"."id";



CREATE TABLE IF NOT EXISTS "public"."subscribers_insights" (
    "id" bigint NOT NULL,
    "distinct_id" "text" NOT NULL,
    "income" "text",
    "net_worth" "text",
    "investing_activity" "text",
    "investing_experience_years" "text",
    "investing_objective" "text",
    "investment_type" "text",
    "acquisition_survey" "text",
    "linked_bank_account" boolean DEFAULT false,
    "available_copy_credits" numeric DEFAULT 0,
    "buying_power" numeric DEFAULT 0,
    "total_deposits" numeric DEFAULT 0,
    "total_deposit_count" integer DEFAULT 0,
    "total_withdrawals" numeric DEFAULT 0,
    "total_withdrawal_count" integer DEFAULT 0,
    "active_created_portfolios" integer DEFAULT 0,
    "lifetime_created_portfolios" integer DEFAULT 0,
    "total_copies" integer DEFAULT 0,
    "total_regular_copies" integer DEFAULT 0,
    "total_premium_copies" integer DEFAULT 0,
    "regular_pdp_views" integer DEFAULT 0,
    "premium_pdp_views" integer DEFAULT 0,
    "paywall_views" integer DEFAULT 0,
    "regular_creator_profile_views" integer DEFAULT 0,
    "premium_creator_profile_views" integer DEFAULT 0,
    "stripe_modal_views" integer DEFAULT 0,
    "app_sessions" integer DEFAULT 0,
    "discover_tab_views" integer DEFAULT 0,
    "leaderboard_tab_views" integer DEFAULT 0,
    "premium_tab_views" integer DEFAULT 0,
    "creator_card_taps" integer DEFAULT 0,
    "portfolio_card_taps" integer DEFAULT 0,
    "total_subscriptions" integer DEFAULT 0,
    "synced_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."subscribers_insights" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscribers_insights" IS 'User-level behavioral and demographic data from Mixpanel.
Each row represents a unique user (distinct_id) and is updated on each sync.
The updated_at timestamp tracks when the user''s data was last refreshed.';



COMMENT ON COLUMN "public"."subscribers_insights"."synced_at" IS 'Timestamp when this user record was first created in the database';



COMMENT ON COLUMN "public"."subscribers_insights"."updated_at" IS 'Timestamp when this user record was last updated from Mixpanel';



CREATE TABLE IF NOT EXISTS "public"."user_portfolio_creator_engagement" (
    "id" bigint NOT NULL,
    "distinct_id" "text" NOT NULL,
    "portfolio_ticker" "text" NOT NULL,
    "creator_id" "text" NOT NULL,
    "creator_username" "text",
    "pdp_view_count" integer DEFAULT 0 NOT NULL,
    "did_copy" boolean DEFAULT false NOT NULL,
    "copy_count" integer DEFAULT 0,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "liquidation_count" integer DEFAULT 0
);


ALTER TABLE "public"."user_portfolio_creator_engagement" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."main_analysis" AS
 WITH "unique_engagement" AS (
         SELECT "user_portfolio_creator_engagement"."distinct_id",
            "count"(DISTINCT "user_portfolio_creator_engagement"."creator_id") AS "unique_creators_viewed",
            "count"(DISTINCT "user_portfolio_creator_engagement"."portfolio_ticker") AS "unique_portfolios_viewed"
           FROM "public"."user_portfolio_creator_engagement"
          GROUP BY "user_portfolio_creator_engagement"."distinct_id"
        )
 SELECT "si"."distinct_id",
    "si"."income",
    "si"."net_worth",
    "si"."investing_activity",
    "si"."investing_experience_years",
    "si"."investing_objective",
    "si"."investment_type",
    "si"."acquisition_survey",
    "si"."linked_bank_account",
    "si"."available_copy_credits",
    "si"."buying_power",
    "si"."total_deposits",
    "si"."total_deposit_count",
    "si"."total_withdrawals",
    "si"."total_withdrawal_count",
    "si"."active_created_portfolios",
    "si"."lifetime_created_portfolios",
    "si"."total_copies",
    "si"."total_regular_copies",
    "si"."total_premium_copies",
    "si"."regular_pdp_views",
    "si"."premium_pdp_views",
    "si"."paywall_views",
    "si"."regular_creator_profile_views",
    "si"."premium_creator_profile_views",
    "si"."total_subscriptions",
    "si"."stripe_modal_views",
    "si"."app_sessions",
    "si"."discover_tab_views",
    "si"."leaderboard_tab_views",
    "si"."premium_tab_views",
    "si"."creator_card_taps",
    "si"."portfolio_card_taps",
    (COALESCE("si"."regular_creator_profile_views", 0) + COALESCE("si"."premium_creator_profile_views", 0)) AS "total_profile_views",
    (COALESCE("si"."regular_pdp_views", 0) + COALESCE("si"."premium_pdp_views", 0)) AS "total_pdp_views",
    COALESCE("ue"."unique_creators_viewed", (0)::bigint) AS "unique_creators_viewed",
    COALESCE("ue"."unique_portfolios_viewed", (0)::bigint) AS "unique_portfolios_viewed",
        CASE
            WHEN ("si"."total_copies" > 0) THEN 1
            ELSE 0
        END AS "did_copy",
        CASE
            WHEN ("si"."total_subscriptions" > 0) THEN 1
            ELSE 0
        END AS "did_subscribe"
   FROM ("public"."subscribers_insights" "si"
     LEFT JOIN "unique_engagement" "ue" ON (("si"."distinct_id" = "ue"."distinct_id")))
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."main_analysis" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."copy_engagement_summary" AS
 SELECT "did_copy",
    "count"(DISTINCT "distinct_id") AS "total_users",
    "round"("avg"("total_profile_views"), 2) AS "avg_profile_views",
    "round"("avg"("total_pdp_views"), 2) AS "avg_pdp_views",
    "round"("avg"("unique_creators_viewed"), 2) AS "avg_unique_creators",
    "round"("avg"("unique_portfolios_viewed"), 2) AS "avg_unique_portfolios"
   FROM "public"."main_analysis"
  GROUP BY "did_copy"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."copy_engagement_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."creator_subscriptions_by_price" (
    "id" bigint NOT NULL,
    "creator_id" "text" NOT NULL,
    "creator_username" "text",
    "subscription_price" numeric,
    "subscription_interval" "text",
    "total_subscriptions" integer,
    "total_paywall_views" integer,
    "synced_at" timestamp with time zone
);


ALTER TABLE "public"."creator_subscriptions_by_price" OWNER TO "postgres";


ALTER TABLE "public"."creator_subscriptions_by_price" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."creator_subscriptions_by_price_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."creators_insights" (
    "id" bigint NOT NULL,
    "synced_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "email" "text",
    "total_deposits" numeric,
    "active_created_portfolios" integer,
    "lifetime_created_portfolios" integer,
    "total_trades" integer,
    "investing_activity" "text",
    "investing_experience_years" "text",
    "investing_objective" "text",
    "investment_type" "text",
    "total_rebalances" integer,
    "total_sessions" integer,
    "total_leaderboard_views" integer
);


ALTER TABLE "public"."creators_insights" OWNER TO "postgres";


ALTER TABLE "public"."creators_insights" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."creators_insights_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."event_sequence_analysis" (
    "id" bigint NOT NULL,
    "analysis_type" "text" NOT NULL,
    "predictive_sequences" "jsonb",
    "critical_triggers" "jsonb",
    "anti_patterns" "jsonb",
    "summary" "text",
    "recommendations" "jsonb",
    "generated_at" timestamp with time zone DEFAULT "now"(),
    "model_used" "text" DEFAULT 'claude-sonnet-4-20250514'::"text"
);


ALTER TABLE "public"."event_sequence_analysis" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_sequence_analysis" IS 'Stores Claude AI analysis results for event
   sequence patterns';



COMMENT ON COLUMN "public"."event_sequence_analysis"."analysis_type" IS 'Either "copies" or 
  "subscriptions"';



COMMENT ON COLUMN "public"."event_sequence_analysis"."predictive_sequences" IS 'Sequences with high 
  predictive power';



COMMENT ON COLUMN "public"."event_sequence_analysis"."critical_triggers" IS 'Events that immediately 
  precede conversion';



COMMENT ON COLUMN "public"."event_sequence_analysis"."anti_patterns" IS 'Sequences associated with 
  low conversion';



COMMENT ON COLUMN "public"."event_sequence_analysis"."recommendations" IS 'Actionable recommendations
   from analysis';



CREATE SEQUENCE IF NOT EXISTS "public"."event_sequence_analysis_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."event_sequence_analysis_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."event_sequence_analysis_id_seq" OWNED BY "public"."event_sequence_analysis"."id";



CREATE TABLE IF NOT EXISTS "public"."event_sequences_raw" (
    "id" bigint NOT NULL,
    "distinct_id" "text" NOT NULL,
    "event_data" "jsonb" NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."event_sequences_raw" OWNER TO "postgres";


COMMENT ON TABLE "public"."event_sequences_raw" IS 'Stores raw event sequences from 
  Mixpanel before processing and joining with conversion outcomes';



COMMENT ON COLUMN "public"."event_sequences_raw"."distinct_id" IS 'Mixpanel distinct_id
   for the user';



COMMENT ON COLUMN "public"."event_sequences_raw"."event_data" IS 'Array of raw event 
  objects with event, time, and count fields';



COMMENT ON COLUMN "public"."event_sequences_raw"."synced_at" IS 'When this data was 
  synced from Mixpanel';



CREATE SEQUENCE IF NOT EXISTS "public"."event_sequences_raw_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."event_sequences_raw_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."event_sequences_raw_id_seq" OWNED BY "public"."event_sequences_raw"."id";



CREATE MATERIALIZED VIEW "public"."portfolio_creator_engagement_metrics" AS
 SELECT "portfolio_ticker",
    "creator_id",
    "creator_username",
    "count"(DISTINCT "distinct_id") AS "unique_viewers",
    "sum"("pdp_view_count") AS "total_pdp_views",
    "sum"(
        CASE
            WHEN "did_copy" THEN "copy_count"
            ELSE 0
        END) AS "total_copies",
    "sum"("liquidation_count") AS "total_liquidations",
    "round"(((("sum"(
        CASE
            WHEN "did_copy" THEN 1
            ELSE 0
        END))::numeric / (NULLIF("count"(DISTINCT "distinct_id"), 0))::numeric) * (100)::numeric), 2) AS "conversion_rate_pct"
   FROM "public"."user_portfolio_creator_engagement" "upce"
  GROUP BY "portfolio_ticker", "creator_id", "creator_username"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."portfolio_creator_engagement_metrics" OWNER TO "postgres";


COMMENT ON MATERIALIZED VIEW "public"."portfolio_creator_engagement_metrics" IS 'Portfolio-creator level aggregation of engagement metrics from user_portfolio_creator_engagement. Aggregates copies, liquidations, and PDP views. Refresh after syncing engagement data.';



CREATE MATERIALIZED VIEW "public"."hidden_gems_portfolios" AS
 SELECT "portfolio_ticker",
    "creator_id",
    "creator_username",
    "unique_viewers",
    "total_pdp_views",
    "total_copies",
    "total_liquidations",
    "conversion_rate_pct",
        CASE
            WHEN ("total_copies" > 0) THEN "round"((("unique_viewers")::numeric / ("total_copies")::numeric), 2)
            ELSE NULL::numeric
        END AS "viewer_copier_ratio"
   FROM "public"."portfolio_creator_engagement_metrics"
  WHERE (("unique_viewers" >= 5) AND ("total_copies" < 5) AND ("unique_viewers" >= ("total_copies" * 5)))
  ORDER BY "unique_viewers" DESC,
        CASE
            WHEN ("total_copies" > 0) THEN "round"((("unique_viewers")::numeric / ("total_copies")::numeric), 2)
            ELSE NULL::numeric
        END DESC
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."hidden_gems_portfolios" OWNER TO "postgres";


COMMENT ON MATERIALIZED VIEW "public"."hidden_gems_portfolios" IS 'Hidden gem portfolios: many unique viewers but few unique copiers (ratio >= 5). Indicates high interest but low conversion. Refreshed via refresh_portfolio_engagement_views().';



CREATE OR REPLACE VIEW "public"."latest_subscription_distribution" AS
 SELECT "round"(
        CASE
            WHEN ("subscription_interval" = 'Quarterly'::"text") THEN ("subscription_price" / 3.0)
            WHEN ("subscription_interval" = ANY (ARRAY['Annually'::"text", 'Annual'::"text"])) THEN ("subscription_price" / 12.0)
            ELSE "subscription_price"
        END, 2) AS "monthly_price",
    "count"(DISTINCT "creator_id") AS "creator_count",
    "sum"("total_subscriptions") AS "total_subscriptions",
    "sum"("total_paywall_views") AS "total_paywall_views",
    "array_agg"(DISTINCT "creator_username" ORDER BY "creator_username") AS "creator_usernames"
   FROM "public"."creator_subscriptions_by_price"
  WHERE ("synced_at" = ( SELECT "max"("creator_subscriptions_by_price_1"."synced_at") AS "max"
           FROM "public"."creator_subscriptions_by_price" "creator_subscriptions_by_price_1"))
  GROUP BY ("round"(
        CASE
            WHEN ("subscription_interval" = 'Quarterly'::"text") THEN ("subscription_price" / 3.0)
            WHEN ("subscription_interval" = ANY (ARRAY['Annually'::"text", 'Annual'::"text"])) THEN ("subscription_price" / 12.0)
            ELSE "subscription_price"
        END, 2))
  ORDER BY ("round"(
        CASE
            WHEN ("subscription_interval" = 'Quarterly'::"text") THEN ("subscription_price" / 3.0)
            WHEN ("subscription_interval" = ANY (ARRAY['Annually'::"text", 'Annual'::"text"])) THEN ("subscription_price" / 12.0)
            ELSE "subscription_price"
        END, 2));


ALTER VIEW "public"."latest_subscription_distribution" OWNER TO "postgres";


COMMENT ON VIEW "public"."latest_subscription_distribution" IS 'Latest subscription price distribution normalized to monthly prices. Rounds to 2 decimal places to group similar prices (e.g., all $8.33 quarterly subscriptions grouped together).';



CREATE TABLE IF NOT EXISTS "public"."marketing_metrics" (
    "id" bigint NOT NULL,
    "avg_monthly_copies" integer,
    "total_investments" integer,
    "total_public_portfolios" integer,
    "total_market_beating_portfolios" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."marketing_metrics" OWNER TO "postgres";


COMMENT ON TABLE "public"."marketing_metrics" IS 'Marketing metrics table (no RLS). Contains public aggregate metrics for marketing dashboard. Single row enforced by trigger.';



CREATE SEQUENCE IF NOT EXISTS "public"."marketing_metrics_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."marketing_metrics_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."marketing_metrics_id_seq" OWNED BY "public"."marketing_metrics"."id";



CREATE TABLE IF NOT EXISTS "public"."materialized_view_refresh_log" (
    "view_name" "text" NOT NULL,
    "last_refreshed_at" timestamp with time zone NOT NULL,
    "refresh_duration_ms" integer,
    "rows_affected" bigint,
    "refreshed_by" "text" DEFAULT 'system'::"text"
);


ALTER TABLE "public"."materialized_view_refresh_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."materialized_view_refresh_log" IS 'Logs refresh times for all materialized views. Query this table to check view freshness and debug data staleness issues.';



CREATE TABLE IF NOT EXISTS "public"."portfolio_performance_metrics" (
    "total_returns_percentage" numeric,
    "total_returns_value" numeric,
    "total_position" numeric,
    "daily_returns_percentage" numeric,
    "daily_returns_value" numeric,
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "inception_date" timestamp with time zone,
    "portfolio_ticker" "text" NOT NULL
);


ALTER TABLE "public"."portfolio_performance_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."premium_creators" (
    "creator_id" "text" NOT NULL,
    "creator_username" "text" NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."premium_creators" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."portfolio_breakdown_with_metrics" AS
 SELECT "pcem"."portfolio_ticker",
    "pcem"."creator_id",
    "pc"."creator_username",
    "pcem"."total_copies",
    "pcem"."total_pdp_views",
    "pcem"."total_liquidations",
        CASE
            WHEN ("pcem"."total_pdp_views" > 0) THEN ((("pcem"."total_copies")::numeric / ("pcem"."total_pdp_views")::numeric) * (100)::numeric)
            ELSE (0)::numeric
        END AS "copy_cvr",
        CASE
            WHEN ("pcem"."total_copies" > 0) THEN ((("pcem"."total_liquidations")::numeric / ("pcem"."total_copies")::numeric) * (100)::numeric)
            ELSE (0)::numeric
        END AS "liquidation_rate",
    "ppm"."total_returns_percentage",
    "ppm"."total_position",
    "ppm"."inception_date",
    "ppm"."uploaded_at" AS "metrics_updated_at"
   FROM (("public"."portfolio_creator_engagement_metrics" "pcem"
     JOIN "public"."premium_creators" "pc" ON (("pcem"."creator_id" = "pc"."creator_id")))
     LEFT JOIN "public"."portfolio_performance_metrics" "ppm" ON (("pcem"."portfolio_ticker" = "ppm"."portfolio_ticker")))
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."portfolio_breakdown_with_metrics" OWNER TO "postgres";


COMMENT ON MATERIALIZED VIEW "public"."portfolio_breakdown_with_metrics" IS 'Portfolio-level breakdown with engagement and performance metrics. Refresh after syncing engagement data or uploading performance metrics.';



CREATE TABLE IF NOT EXISTS "public"."portfolio_creator_copy_metrics" (
    "id" bigint NOT NULL,
    "portfolio_ticker" "text" NOT NULL,
    "creator_id" "text" NOT NULL,
    "creator_username" "text" NOT NULL,
    "total_copies" integer DEFAULT 0 NOT NULL,
    "total_liquidations" integer DEFAULT 0 NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."portfolio_creator_copy_metrics" OWNER TO "postgres";


COMMENT ON TABLE "public"."portfolio_creator_copy_metrics" IS 'Portfolio-level aggregated copy and liquidation metrics from Mixpanel chart 86055000.
This is NOT user-level data - these are portfolio-creator aggregates.
Refreshed during engagement sync via sync-mixpanel-engagement → process-copy-metrics chain.';



CREATE SEQUENCE IF NOT EXISTS "public"."portfolio_creator_copy_metrics_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."portfolio_creator_copy_metrics_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."portfolio_creator_copy_metrics_id_seq" OWNED BY "public"."portfolio_creator_copy_metrics"."id";



CREATE TABLE IF NOT EXISTS "public"."portfolio_stock_holdings" (
    "id" bigint NOT NULL,
    "portfolio_ticker" "text" NOT NULL,
    "stock_ticker" "text" NOT NULL,
    "position_count" integer NOT NULL,
    "total_quantity" numeric NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."portfolio_stock_holdings" OWNER TO "postgres";


COMMENT ON TABLE "public"."portfolio_stock_holdings" IS 'Stock holdings for each portfolio. Uploaded manually via CSV. Links to premium creators via portfolio_creator_engagement_metrics.';



CREATE SEQUENCE IF NOT EXISTS "public"."portfolio_stock_holdings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."portfolio_stock_holdings_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."portfolio_stock_holdings_id_seq" OWNED BY "public"."portfolio_stock_holdings"."id";



CREATE OR REPLACE VIEW "public"."premium_creator_copy_affinity_base" AS
 WITH "premium_creators_list" AS (
         SELECT "premium_creators"."creator_username",
            "array_agg"("premium_creators"."creator_id") AS "creator_ids"
           FROM "public"."premium_creators"
          GROUP BY "premium_creators"."creator_username"
        ), "premium_creator_copiers" AS (
         SELECT "pc_1"."creator_username" AS "premium_creator",
            "upce"."distinct_id" AS "copier_id",
            "upce"."portfolio_ticker",
            "upce"."copy_count",
            "upce"."liquidation_count"
           FROM (("premium_creators_list" "pc_1"
             CROSS JOIN LATERAL "unnest"("pc_1"."creator_ids") "pc_creator_id"("pc_creator_id"))
             JOIN "public"."user_portfolio_creator_engagement" "upce" ON ((("pc_creator_id"."pc_creator_id" = "upce"."creator_id") AND ("upce"."did_copy" = true))))
        ), "premium_totals" AS (
         SELECT "pc_1"."creator_username" AS "premium_creator",
            "sum"("pccm"."total_copies") AS "total_copies",
            "sum"("pccm"."total_liquidations") AS "total_liquidations"
           FROM ("public"."premium_creators" "pc_1"
             LEFT JOIN "public"."portfolio_creator_copy_metrics" "pccm" ON (("pc_1"."creator_id" = "pccm"."creator_id")))
          GROUP BY "pc_1"."creator_username"
        ), "affinity_raw" AS (
         SELECT "pcc"."premium_creator",
            "upce2"."creator_username" AS "copied_creator",
            "upce2"."distinct_id" AS "copier_id",
            "upce2"."portfolio_ticker",
            "upce2"."copy_count"
           FROM ("premium_creator_copiers" "pcc"
             JOIN "public"."user_portfolio_creator_engagement" "upce2" ON ((("pcc"."copier_id" = "upce2"."distinct_id") AND ("upce2"."did_copy" = true))))
          WHERE ("upce2"."creator_username" <> "pcc"."premium_creator")
        )
 SELECT "ar"."premium_creator",
    "pt"."total_copies" AS "premium_creator_total_copies",
    "pt"."total_liquidations" AS "premium_creator_total_liquidations",
    "ar"."copied_creator",
        CASE
            WHEN ("pc"."creator_username" IS NOT NULL) THEN 'Premium'::"text"
            ELSE 'Regular'::"text"
        END AS "copy_type",
    "count"(DISTINCT "ar"."copier_id") AS "unique_copiers",
    "count"(*) AS "total_copies"
   FROM (("affinity_raw" "ar"
     JOIN "premium_totals" "pt" ON (("ar"."premium_creator" = "pt"."premium_creator")))
     LEFT JOIN "premium_creators_list" "pc" ON (("ar"."copied_creator" = "pc"."creator_username")))
  GROUP BY "ar"."premium_creator", "pt"."total_copies", "pt"."total_liquidations", "ar"."copied_creator", "pc"."creator_username"
  ORDER BY "ar"."premium_creator", ("count"(DISTINCT "ar"."copier_id")) DESC;


ALTER VIEW "public"."premium_creator_copy_affinity_base" OWNER TO "postgres";


COMMENT ON VIEW "public"."premium_creator_copy_affinity_base" IS 'Premium creator affinity analysis. Uses portfolio_creator_copy_metrics (chart 86055000) for copy/liquidation totals (same source as premium_creator_breakdown to ensure consistency).';



CREATE OR REPLACE VIEW "public"."premium_creator_affinity_display" AS
 WITH "premium_totals_direct" AS (
         SELECT "pc"."creator_username" AS "premium_creator",
            COALESCE("sum"("pccm"."total_copies"), (0)::bigint) AS "premium_creator_total_copies",
            COALESCE("sum"("pccm"."total_liquidations"), (0)::bigint) AS "premium_creator_total_liquidations"
           FROM ("public"."premium_creators" "pc"
             LEFT JOIN "public"."portfolio_creator_copy_metrics" "pccm" ON (("pc"."creator_id" = "pccm"."creator_id")))
          GROUP BY "pc"."creator_username"
        ), "all_premium_creators" AS (
         SELECT "pc"."creator_username" AS "premium_creator",
            COALESCE("pt"."premium_creator_total_copies", (0)::bigint) AS "premium_creator_total_copies",
            COALESCE("pt"."premium_creator_total_liquidations", (0)::bigint) AS "premium_creator_total_liquidations"
           FROM (( SELECT DISTINCT "premium_creators"."creator_username"
                   FROM "public"."premium_creators") "pc"
             LEFT JOIN "premium_totals_direct" "pt" ON (("pc"."creator_username" = "pt"."premium_creator")))
        ), "ranked_regular" AS (
         SELECT "premium_creator_copy_affinity_base"."premium_creator",
            "premium_creator_copy_affinity_base"."copied_creator",
            "premium_creator_copy_affinity_base"."total_copies",
            "premium_creator_copy_affinity_base"."unique_copiers",
            "row_number"() OVER (PARTITION BY "premium_creator_copy_affinity_base"."premium_creator" ORDER BY "premium_creator_copy_affinity_base"."unique_copiers" DESC, "premium_creator_copy_affinity_base"."total_copies" DESC) AS "rank"
           FROM "public"."premium_creator_copy_affinity_base"
          WHERE ("premium_creator_copy_affinity_base"."copy_type" = 'Regular'::"text")
        ), "ranked_premium" AS (
         SELECT "premium_creator_copy_affinity_base"."premium_creator",
            "premium_creator_copy_affinity_base"."copied_creator",
            "premium_creator_copy_affinity_base"."total_copies",
            "premium_creator_copy_affinity_base"."unique_copiers",
            "row_number"() OVER (PARTITION BY "premium_creator_copy_affinity_base"."premium_creator" ORDER BY "premium_creator_copy_affinity_base"."unique_copiers" DESC, "premium_creator_copy_affinity_base"."total_copies" DESC) AS "rank"
           FROM "public"."premium_creator_copy_affinity_base"
          WHERE ("premium_creator_copy_affinity_base"."copy_type" = 'Premium'::"text")
        )
 SELECT "apc"."premium_creator",
    "apc"."premium_creator_total_copies",
    "apc"."premium_creator_total_liquidations",
    (("max"(
        CASE
            WHEN ("rr"."rank" = 1) THEN (("rr"."copied_creator" || ' (Regular): '::"text") || "rr"."total_copies")
            ELSE NULL::"text"
        END) ||
        CASE
            WHEN ("max"(
            CASE
                WHEN ("rp"."rank" = 1) THEN 1
                ELSE NULL::integer
            END) = 1) THEN ' | '::"text"
            ELSE ''::"text"
        END) || "max"(
        CASE
            WHEN ("rp"."rank" = 1) THEN (("rp"."copied_creator" || ' (Premium): '::"text") || "rp"."total_copies")
            ELSE NULL::"text"
        END)) AS "top_1",
    (("max"(
        CASE
            WHEN ("rr"."rank" = 2) THEN (("rr"."copied_creator" || ' (Regular): '::"text") || "rr"."total_copies")
            ELSE NULL::"text"
        END) ||
        CASE
            WHEN ("max"(
            CASE
                WHEN ("rp"."rank" = 2) THEN 1
                ELSE NULL::integer
            END) = 1) THEN ' | '::"text"
            ELSE ''::"text"
        END) || "max"(
        CASE
            WHEN ("rp"."rank" = 2) THEN (("rp"."copied_creator" || ' (Premium): '::"text") || "rp"."total_copies")
            ELSE NULL::"text"
        END)) AS "top_2",
    (("max"(
        CASE
            WHEN ("rr"."rank" = 3) THEN (("rr"."copied_creator" || ' (Regular): '::"text") || "rr"."total_copies")
            ELSE NULL::"text"
        END) ||
        CASE
            WHEN ("max"(
            CASE
                WHEN ("rp"."rank" = 3) THEN 1
                ELSE NULL::integer
            END) = 1) THEN ' | '::"text"
            ELSE ''::"text"
        END) || "max"(
        CASE
            WHEN ("rp"."rank" = 3) THEN (("rp"."copied_creator" || ' (Premium): '::"text") || "rp"."total_copies")
            ELSE NULL::"text"
        END)) AS "top_3",
    (("max"(
        CASE
            WHEN ("rr"."rank" = 4) THEN (("rr"."copied_creator" || ' (Regular): '::"text") || "rr"."total_copies")
            ELSE NULL::"text"
        END) ||
        CASE
            WHEN ("max"(
            CASE
                WHEN ("rp"."rank" = 4) THEN 1
                ELSE NULL::integer
            END) = 1) THEN ' | '::"text"
            ELSE ''::"text"
        END) || "max"(
        CASE
            WHEN ("rp"."rank" = 4) THEN (("rp"."copied_creator" || ' (Premium): '::"text") || "rp"."total_copies")
            ELSE NULL::"text"
        END)) AS "top_4",
    (("max"(
        CASE
            WHEN ("rr"."rank" = 5) THEN (("rr"."copied_creator" || ' (Regular): '::"text") || "rr"."total_copies")
            ELSE NULL::"text"
        END) ||
        CASE
            WHEN ("max"(
            CASE
                WHEN ("rp"."rank" = 5) THEN 1
                ELSE NULL::integer
            END) = 1) THEN ' | '::"text"
            ELSE ''::"text"
        END) || "max"(
        CASE
            WHEN ("rp"."rank" = 5) THEN (("rp"."copied_creator" || ' (Premium): '::"text") || "rp"."total_copies")
            ELSE NULL::"text"
        END)) AS "top_5"
   FROM (("all_premium_creators" "apc"
     LEFT JOIN "ranked_regular" "rr" ON ((("apc"."premium_creator" = "rr"."premium_creator") AND ("rr"."rank" <= 5))))
     LEFT JOIN "ranked_premium" "rp" ON ((("apc"."premium_creator" = "rp"."premium_creator") AND ("rp"."rank" <= 5))))
  GROUP BY "apc"."premium_creator", "apc"."premium_creator_total_copies", "apc"."premium_creator_total_liquidations"
  ORDER BY "apc"."premium_creator_total_copies" DESC NULLS LAST, "apc"."premium_creator";


ALTER VIEW "public"."premium_creator_affinity_display" OWNER TO "postgres";


COMMENT ON VIEW "public"."premium_creator_affinity_display" IS 'Display-formatted view of premium creator copy affinity with top 5 co-copied creators. Uses aggregated copy metrics from chart 86055000 for consistency with Premium Creator Breakdown.';



CREATE TABLE IF NOT EXISTS "public"."premium_creator_metrics" (
    "id" bigint NOT NULL,
    "creator_id" "text" NOT NULL,
    "creator_username" "text",
    "total_subscriptions" integer DEFAULT 0,
    "total_paywall_views" integer DEFAULT 0,
    "total_stripe_modal_views" integer DEFAULT 0,
    "total_cancellations" integer DEFAULT 0,
    "synced_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."premium_creator_metrics" OWNER TO "postgres";


COMMENT ON TABLE "public"."premium_creator_metrics" IS 'Creator-level subscription metrics from Mixpanel chart 85821646. Synced by sync-creator-data Edge Function.';



CREATE OR REPLACE VIEW "public"."premium_creator_breakdown" AS
 WITH "engagement_by_username" AS (
         SELECT "pc_1"."creator_username",
            "sum"("pcem"."total_pdp_views") AS "total_pdp_views"
           FROM ("public"."premium_creators" "pc_1"
             LEFT JOIN "public"."portfolio_creator_engagement_metrics" "pcem" ON (("pc_1"."creator_id" = "pcem"."creator_id")))
          GROUP BY "pc_1"."creator_username"
        ), "copy_metrics_by_username" AS (
         SELECT "pc_1"."creator_username",
            "sum"("pccm"."total_copies") AS "total_copies",
            "sum"("pccm"."total_liquidations") AS "total_liquidations"
           FROM ("public"."premium_creators" "pc_1"
             LEFT JOIN "public"."portfolio_creator_copy_metrics" "pccm" ON (("pc_1"."creator_id" = "pccm"."creator_id")))
          GROUP BY "pc_1"."creator_username"
        ), "subscription_by_username" AS (
         SELECT "pc_1"."creator_username",
            "max"("pcm"."total_subscriptions") AS "total_subscriptions",
            "max"("pcm"."total_paywall_views") AS "total_paywall_views",
            "max"("pcm"."total_cancellations") AS "total_cancellations"
           FROM ("public"."premium_creators" "pc_1"
             LEFT JOIN "public"."premium_creator_metrics" "pcm" ON (("pc_1"."creator_id" = "pcm"."creator_id")))
          GROUP BY "pc_1"."creator_username"
        ), "performance_by_username" AS (
         SELECT "pc_1"."creator_username",
            "ppm"."portfolio_ticker",
            "ppm"."total_returns_percentage",
            "ppm"."total_position"
           FROM (("public"."premium_creators" "pc_1"
             LEFT JOIN "public"."portfolio_creator_engagement_metrics" "pcem" ON (("pc_1"."creator_id" = "pcem"."creator_id")))
             LEFT JOIN "public"."portfolio_performance_metrics" "ppm" ON (("pcem"."portfolio_ticker" = "ppm"."portfolio_ticker")))
          GROUP BY "pc_1"."creator_username", "ppm"."portfolio_ticker", "ppm"."total_returns_percentage", "ppm"."total_position"
        )
 SELECT "pc"."creator_username",
    COALESCE("copy"."total_copies", (0)::bigint) AS "total_copies",
    COALESCE("eng"."total_pdp_views", (0)::numeric) AS "total_pdp_views",
    COALESCE("copy"."total_liquidations", (0)::bigint) AS "total_liquidations",
        CASE
            WHEN (COALESCE("copy"."total_copies", (0)::bigint) > 0) THEN (((COALESCE("copy"."total_liquidations", (0)::bigint))::numeric / (COALESCE("copy"."total_copies", (1)::bigint))::numeric) * (100)::numeric)
            ELSE (0)::numeric
        END AS "liquidation_rate",
    COALESCE("sub"."total_subscriptions", 0) AS "total_subscriptions",
    COALESCE("sub"."total_paywall_views", 0) AS "total_paywall_views",
    COALESCE("sub"."total_cancellations", 0) AS "total_cancellations",
        CASE
            WHEN (COALESCE("sub"."total_paywall_views", 0) > 0) THEN (((COALESCE("sub"."total_subscriptions", 0))::numeric / (COALESCE("sub"."total_paywall_views", 1))::numeric) * (100)::numeric)
            ELSE (0)::numeric
        END AS "subscription_cvr",
        CASE
            WHEN (COALESCE("sub"."total_subscriptions", 0) > 0) THEN (((COALESCE("sub"."total_cancellations", 0))::numeric / (COALESCE("sub"."total_subscriptions", 1))::numeric) * (100)::numeric)
            ELSE (0)::numeric
        END AS "cancellation_rate",
    "avg"("perf"."total_returns_percentage") AS "avg_all_time_returns",
        CASE
            WHEN ("sum"("perf"."total_position") > (0)::numeric) THEN "sum"("perf"."total_position")
            ELSE NULL::numeric
        END AS "total_copy_capital"
   FROM ((((( SELECT DISTINCT "premium_creators"."creator_username"
           FROM "public"."premium_creators") "pc"
     LEFT JOIN "engagement_by_username" "eng" ON (("pc"."creator_username" = "eng"."creator_username")))
     LEFT JOIN "copy_metrics_by_username" "copy" ON (("pc"."creator_username" = "copy"."creator_username")))
     LEFT JOIN "subscription_by_username" "sub" ON (("pc"."creator_username" = "sub"."creator_username")))
     LEFT JOIN "performance_by_username" "perf" ON (("pc"."creator_username" = "perf"."creator_username")))
  GROUP BY "pc"."creator_username", "eng"."total_pdp_views", "copy"."total_copies", "copy"."total_liquidations", "sub"."total_subscriptions", "sub"."total_paywall_views", "sub"."total_cancellations";


ALTER VIEW "public"."premium_creator_breakdown" OWNER TO "postgres";


COMMENT ON VIEW "public"."premium_creator_breakdown" IS 'Creator-level aggregated metrics for Premium Creator Breakdown. Regular view (not materialized) that always shows fresh data. Uses portfolio_creator_copy_metrics (chart 86055000) for copies/liquidations. No refresh needed - updates automatically when underlying data changes.';



CREATE SEQUENCE IF NOT EXISTS "public"."premium_creator_metrics_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."premium_creator_metrics_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."premium_creator_metrics_id_seq" OWNED BY "public"."premium_creator_metrics"."id";



CREATE OR REPLACE VIEW "public"."premium_creator_metrics_latest" AS
 SELECT DISTINCT ON ("creator_id") "creator_id",
    "creator_username",
    "total_subscriptions",
    "total_paywall_views",
    "total_stripe_modal_views",
    "total_cancellations",
    "synced_at"
   FROM "public"."premium_creator_metrics"
  ORDER BY "creator_id", "synced_at" DESC;


ALTER VIEW "public"."premium_creator_metrics_latest" OWNER TO "postgres";


COMMENT ON VIEW "public"."premium_creator_metrics_latest" IS 'Returns the latest sync data for each creator.';



CREATE TABLE IF NOT EXISTS "public"."premium_creator_retention_events" (
    "distinct_id" "text" NOT NULL,
    "creator_username" "text" NOT NULL,
    "cohort_month" "text" NOT NULL,
    "cohort_date" "date" NOT NULL,
    "subscribed_count" integer DEFAULT 0,
    "renewed_count" integer DEFAULT 0,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."premium_creator_retention_events" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."premium_creator_retention_analysis" AS
 WITH "cohort_subscribers" AS (
         SELECT "premium_creator_retention_events"."creator_username",
            "premium_creator_retention_events"."cohort_month",
            "premium_creator_retention_events"."cohort_date",
            "premium_creator_retention_events"."distinct_id",
            "premium_creator_retention_events"."subscribed_count"
           FROM "public"."premium_creator_retention_events"
          WHERE ("premium_creator_retention_events"."subscribed_count" > 0)
        ), "cohort_summary" AS (
         SELECT "cohort_subscribers"."creator_username",
            "cohort_subscribers"."cohort_month",
            "cohort_subscribers"."cohort_date",
            "count"(DISTINCT "cohort_subscribers"."distinct_id") AS "initial_subscribers"
           FROM "cohort_subscribers"
          GROUP BY "cohort_subscribers"."creator_username", "cohort_subscribers"."cohort_month", "cohort_subscribers"."cohort_date"
        ), "retention_calculations" AS (
         SELECT "cs"."creator_username",
            "cs"."cohort_month",
            "cs"."cohort_date",
            "summary"."initial_subscribers" AS "first",
            "count"(DISTINCT
                CASE
                    WHEN (("renewal"."cohort_month" = "cs"."cohort_month") AND ("renewal"."renewed_count" > 0)) THEN "renewal"."distinct_id"
                    ELSE NULL::"text"
                END) AS "month_0_retained",
            "count"(DISTINCT
                CASE
                    WHEN (("renewal"."cohort_date" = ("cs"."cohort_date" + '1 mon'::interval)) AND ("renewal"."renewed_count" > 0)) THEN "renewal"."distinct_id"
                    ELSE NULL::"text"
                END) AS "month_1_retained",
            "count"(DISTINCT
                CASE
                    WHEN (("renewal"."cohort_date" = ("cs"."cohort_date" + '2 mons'::interval)) AND ("renewal"."renewed_count" > 0)) THEN "renewal"."distinct_id"
                    ELSE NULL::"text"
                END) AS "month_2_retained",
            "count"(DISTINCT
                CASE
                    WHEN (("renewal"."cohort_date" = ("cs"."cohort_date" + '3 mons'::interval)) AND ("renewal"."renewed_count" > 0)) THEN "renewal"."distinct_id"
                    ELSE NULL::"text"
                END) AS "month_3_retained",
            "count"(DISTINCT
                CASE
                    WHEN (("renewal"."cohort_date" = ("cs"."cohort_date" + '4 mons'::interval)) AND ("renewal"."renewed_count" > 0)) THEN "renewal"."distinct_id"
                    ELSE NULL::"text"
                END) AS "month_4_retained",
            "count"(DISTINCT
                CASE
                    WHEN (("renewal"."cohort_date" = ("cs"."cohort_date" + '5 mons'::interval)) AND ("renewal"."renewed_count" > 0)) THEN "renewal"."distinct_id"
                    ELSE NULL::"text"
                END) AS "month_5_retained",
            "count"(DISTINCT
                CASE
                    WHEN (("renewal"."cohort_date" = ("cs"."cohort_date" + '6 mons'::interval)) AND ("renewal"."renewed_count" > 0)) THEN "renewal"."distinct_id"
                    ELSE NULL::"text"
                END) AS "month_6_retained"
           FROM (("cohort_subscribers" "cs"
             JOIN "cohort_summary" "summary" ON ((("cs"."creator_username" = "summary"."creator_username") AND ("cs"."cohort_date" = "summary"."cohort_date"))))
             LEFT JOIN "public"."premium_creator_retention_events" "renewal" ON ((("cs"."distinct_id" = "renewal"."distinct_id") AND ("cs"."creator_username" = "renewal"."creator_username") AND (("renewal"."cohort_date" >= "cs"."cohort_date") AND ("renewal"."cohort_date" <= ("cs"."cohort_date" + '6 mons'::interval))))))
          GROUP BY "cs"."creator_username", "cs"."cohort_month", "cs"."cohort_date", "summary"."initial_subscribers"
        )
 SELECT "creator_username",
    "cohort_month",
    "cohort_date",
    "first",
    ARRAY["month_0_retained", "month_1_retained", "month_2_retained", "month_3_retained", "month_4_retained", "month_5_retained", "month_6_retained"] AS "counts"
   FROM "retention_calculations"
  ORDER BY "creator_username", "cohort_date"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."premium_creator_retention_analysis" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."premium_creator_stock_holdings" AS
 SELECT "pc"."creator_username",
    "psh"."stock_ticker",
    "sum"("psh"."total_quantity") AS "total_quantity",
    "count"(DISTINCT "psh"."portfolio_ticker") AS "portfolio_count"
   FROM (("public"."portfolio_stock_holdings" "psh"
     JOIN "public"."portfolio_creator_engagement_metrics" "pcem" ON (("psh"."portfolio_ticker" = "pcem"."portfolio_ticker")))
     JOIN "public"."premium_creators" "pc" ON (("pcem"."creator_id" = "pc"."creator_id")))
  WHERE (("psh"."stock_ticker" IS NOT NULL) AND ("psh"."stock_ticker" <> ''::"text"))
  GROUP BY "pc"."creator_username", "psh"."stock_ticker"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."premium_creator_stock_holdings" OWNER TO "postgres";


COMMENT ON MATERIALIZED VIEW "public"."premium_creator_stock_holdings" IS 'Aggregates stock holdings by premium creator. Refresh after uploading portfolio stock holdings data.';



CREATE OR REPLACE VIEW "public"."premium_creator_summary_stats" AS
 SELECT "avg"("subscription_cvr") AS "avg_subscription_cvr",
    "percentile_cont"((0.5)::double precision) WITHIN GROUP (ORDER BY (("avg_all_time_returns")::double precision)) AS "median_all_time_performance",
    "percentile_cont"((0.5)::double precision) WITHIN GROUP (ORDER BY (("total_copy_capital")::double precision)) AS "median_copy_capital",
    "count"(*) AS "total_creators"
   FROM "public"."premium_creator_breakdown";


ALTER VIEW "public"."premium_creator_summary_stats" OWNER TO "postgres";


COMMENT ON VIEW "public"."premium_creator_summary_stats" IS 'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab.';



CREATE OR REPLACE VIEW "public"."premium_creator_top_5_stocks" AS
 WITH "stock_aggregation" AS (
         SELECT "pc"."creator_username",
            "psh"."stock_ticker",
            "psh"."total_quantity"
           FROM (("public"."premium_creators" "pc"
             LEFT JOIN "public"."portfolio_creator_engagement_metrics" "pcem" ON (("pc"."creator_id" = "pcem"."creator_id")))
             LEFT JOIN "public"."portfolio_stock_holdings" "psh" ON (("pcem"."portfolio_ticker" = "psh"."portfolio_ticker")))
          WHERE ("psh"."stock_ticker" IS NOT NULL)
        ), "ranked_stocks" AS (
         SELECT "stock_aggregation"."creator_username",
            "stock_aggregation"."stock_ticker",
            "sum"("stock_aggregation"."total_quantity") AS "total_quantity",
            "row_number"() OVER (PARTITION BY "stock_aggregation"."creator_username" ORDER BY ("sum"("stock_aggregation"."total_quantity")) DESC) AS "rank"
           FROM "stock_aggregation"
          GROUP BY "stock_aggregation"."creator_username", "stock_aggregation"."stock_ticker"
        )
 SELECT "rs"."creator_username",
    "array_agg"("json_build_object"('ticker', "rs"."stock_ticker", 'quantity', "rs"."total_quantity") ORDER BY "rs"."rank") FILTER (WHERE ("rs"."rank" <= 5)) AS "top_5_stocks",
    "pcb"."total_copies"
   FROM ("ranked_stocks" "rs"
     LEFT JOIN "public"."premium_creator_breakdown" "pcb" ON (("rs"."creator_username" = "pcb"."creator_username")))
  WHERE ("rs"."rank" <= 5)
  GROUP BY "rs"."creator_username", "pcb"."total_copies";


ALTER VIEW "public"."premium_creator_top_5_stocks" OWNER TO "postgres";


COMMENT ON VIEW "public"."premium_creator_top_5_stocks" IS 'Top 5 stock holdings for each premium creator. Includes total_copies column for sorting.';



CREATE SEQUENCE IF NOT EXISTS "public"."subscribers_insights_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."subscribers_insights_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."subscribers_insights_id_seq" OWNED BY "public"."subscribers_insights"."id";



CREATE TABLE IF NOT EXISTS "public"."subscribers_insights_v2" (
    "distinct_id" "text" NOT NULL,
    "income" "text",
    "net_worth" "text",
    "investing_activity" "text",
    "investing_experience_years" integer,
    "investing_objective" "text",
    "investment_type" "text",
    "acquisition_survey" "text",
    "linked_bank_account" boolean DEFAULT false,
    "available_copy_credits" numeric DEFAULT 0,
    "buying_power" numeric DEFAULT 0,
    "total_deposits" numeric DEFAULT 0,
    "total_deposit_count" integer DEFAULT 0,
    "total_withdrawals" numeric DEFAULT 0,
    "total_withdrawal_count" integer DEFAULT 0,
    "active_created_portfolios" integer DEFAULT 0,
    "lifetime_created_portfolios" integer DEFAULT 0,
    "total_copies" integer DEFAULT 0,
    "total_pdp_views" integer DEFAULT 0,
    "total_creator_profile_views" integer DEFAULT 0,
    "total_ach_transfers" integer DEFAULT 0,
    "paywall_views" integer DEFAULT 0,
    "total_subscriptions" integer DEFAULT 0,
    "app_sessions" integer DEFAULT 0,
    "discover_tab_views" integer DEFAULT 0,
    "stripe_modal_views" integer DEFAULT 0,
    "creator_card_taps" integer DEFAULT 0,
    "portfolio_card_taps" integer DEFAULT 0,
    "leaderboard_tab_views" integer DEFAULT 0,
    "premium_tab_views" integer DEFAULT 0,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "data_source" "text" DEFAULT 'export_api'::"text",
    "events_processed" integer DEFAULT 0,
    "first_event_time" timestamp with time zone,
    "last_event_time" timestamp with time zone
);


ALTER TABLE "public"."subscribers_insights_v2" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscribers_insights_v2" IS 'Test table for Event Export API approach. Populated from raw Mixpanel events instead of Insights API aggregations. Parallel implementation to compare with subscribers_insights.';



COMMENT ON COLUMN "public"."subscribers_insights_v2"."data_source" IS 'Always "export_api" to distinguish from Insights API data in subscribers_insights table';



COMMENT ON COLUMN "public"."subscribers_insights_v2"."events_processed" IS 'Number of events that contributed to this user profile (for debugging/validation)';



COMMENT ON COLUMN "public"."subscribers_insights_v2"."first_event_time" IS 'Timestamp of earliest event for this user (from event properties.time)';



COMMENT ON COLUMN "public"."subscribers_insights_v2"."last_event_time" IS 'Timestamp of most recent event for this user (from event properties.time)';



CREATE TABLE IF NOT EXISTS "public"."subscription_drivers" (
    "id" bigint NOT NULL,
    "variable_name" "text" NOT NULL,
    "correlation_coefficient" numeric NOT NULL,
    "t_stat" numeric NOT NULL,
    "tipping_point" "text",
    "predictive_strength" "text",
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscription_drivers" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscription_drivers" IS 'Stores regression analysis results for subscription prediction. Updated during user analysis sync workflow.';



COMMENT ON COLUMN "public"."subscription_drivers"."variable_name" IS 'Event or behavior variable name (e.g., "profile_views", "pdp_views")';



COMMENT ON COLUMN "public"."subscription_drivers"."correlation_coefficient" IS 'Correlation coefficient with subscription outcome';



COMMENT ON COLUMN "public"."subscription_drivers"."t_stat" IS 'T-statistic from logistic regression';



COMMENT ON COLUMN "public"."subscription_drivers"."tipping_point" IS 'The threshold value where conversion rate significantly increases';



COMMENT ON COLUMN "public"."subscription_drivers"."predictive_strength" IS 'Categorized strength: Very Strong, Strong, Moderate-Strong, etc.';



COMMENT ON COLUMN "public"."subscription_drivers"."synced_at" IS 'Timestamp of when this data was last updated';



CREATE SEQUENCE IF NOT EXISTS "public"."subscription_drivers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."subscription_drivers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."subscription_drivers_id_seq" OWNED BY "public"."subscription_drivers"."id";



CREATE MATERIALIZED VIEW "public"."subscription_engagement_summary" AS
 SELECT "did_subscribe",
    "count"(DISTINCT "distinct_id") AS "total_users",
    "round"("avg"("total_profile_views"), 2) AS "avg_profile_views",
    "round"("avg"("total_pdp_views"), 2) AS "avg_pdp_views",
    "round"("avg"("unique_creators_viewed"), 2) AS "avg_unique_creators",
    "round"("avg"("unique_portfolios_viewed"), 2) AS "avg_unique_portfolios"
   FROM "public"."main_analysis"
  GROUP BY "did_subscribe"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."subscription_engagement_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sync_logs" (
    "id" bigint NOT NULL,
    "sync_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sync_completed_at" timestamp with time zone,
    "sync_status" "text" DEFAULT 'in_progress'::"text" NOT NULL,
    "source" "text" DEFAULT 'mixpanel'::"text",
    "triggered_by" "text",
    "subscribers_fetched" integer DEFAULT 0,
    "time_funnels_fetched" integer DEFAULT 0,
    "total_records_inserted" integer DEFAULT 0,
    "error_message" "text",
    "error_details" "jsonb",
    "duration_seconds" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tool_type" "text" DEFAULT 'user'::"text",
    CONSTRAINT "sync_logs_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['in_progress'::"text", 'completed'::"text", 'failed'::"text", 'partial'::"text"]))),
    CONSTRAINT "sync_logs_tool_type_check" CHECK (("tool_type" = ANY (ARRAY['user'::"text", 'creator'::"text"])))
);


ALTER TABLE "public"."sync_logs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sync_logs"."tool_type" IS 'Type of analysis tool: user or creator';



CREATE SEQUENCE IF NOT EXISTS "public"."sync_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sync_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sync_logs_id_seq" OWNED BY "public"."sync_logs"."id";



CREATE MATERIALIZED VIEW "public"."top_stocks_all_premium_creators" AS
 WITH "ranked_stocks" AS (
         SELECT "premium_creator_stock_holdings"."stock_ticker",
            "sum"("premium_creator_stock_holdings"."total_quantity") AS "total_quantity",
            "count"(DISTINCT "premium_creator_stock_holdings"."creator_username") AS "creator_count",
            "sum"("premium_creator_stock_holdings"."portfolio_count") AS "portfolio_count",
            "row_number"() OVER (ORDER BY ("sum"("premium_creator_stock_holdings"."total_quantity")) DESC) AS "rank"
           FROM "public"."premium_creator_stock_holdings"
          GROUP BY "premium_creator_stock_holdings"."stock_ticker"
        )
 SELECT "rank",
    "stock_ticker",
    "total_quantity",
    "creator_count",
    "portfolio_count"
   FROM "ranked_stocks"
  WHERE ("rank" <= 5)
  ORDER BY "rank"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."top_stocks_all_premium_creators" OWNER TO "postgres";


COMMENT ON MATERIALIZED VIEW "public"."top_stocks_all_premium_creators" IS 'Top 5 stocks held by all premium creators combined. Refresh after uploading portfolio stock holdings data.';



CREATE TABLE IF NOT EXISTS "public"."user_creator_engagement" (
    "distinct_id" "text" NOT NULL,
    "creator_id" "text" NOT NULL,
    "creator_username" "text",
    "profile_view_count" integer DEFAULT 0,
    "did_subscribe" boolean DEFAULT false,
    "subscription_count" integer DEFAULT 0,
    "synced_at" timestamp without time zone
);


ALTER TABLE "public"."user_creator_engagement" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_creator_profile_copies" AS
 SELECT "uce"."distinct_id",
    "uce"."creator_id",
    "uce"."creator_username",
    "uce"."profile_view_count",
    COALESCE("agg"."did_copy", false) AS "did_copy",
    COALESCE("agg"."copy_count", 0) AS "copy_count"
   FROM ("public"."user_creator_engagement" "uce"
     LEFT JOIN ( SELECT "user_portfolio_creator_engagement"."distinct_id",
            "user_portfolio_creator_engagement"."creator_id",
            ("max"(
                CASE
                    WHEN "user_portfolio_creator_engagement"."did_copy" THEN 1
                    ELSE 0
                END))::boolean AS "did_copy",
            ("sum"("user_portfolio_creator_engagement"."copy_count"))::integer AS "copy_count"
           FROM "public"."user_portfolio_creator_engagement"
          GROUP BY "user_portfolio_creator_engagement"."distinct_id", "user_portfolio_creator_engagement"."creator_id") "agg" ON ((("uce"."distinct_id" = "agg"."distinct_id") AND ("uce"."creator_id" = "agg"."creator_id"))));


ALTER VIEW "public"."user_creator_profile_copies" OWNER TO "postgres";


COMMENT ON VIEW "public"."user_creator_profile_copies" IS 'Creator-level engagement with 
  copy behavior aggregated across all portfolios by that creator. Used for 
  analyzing which creator profile view combinations drive copies.';



CREATE TABLE IF NOT EXISTS "public"."user_event_sequences" (
    "distinct_id" "text" NOT NULL,
    "event_sequence" "jsonb" NOT NULL,
    "total_copies" integer DEFAULT 0,
    "total_subscriptions" integer DEFAULT 0,
    "synced_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_event_sequences" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_event_sequences" IS 'Stores chronological event sequences per user 
  with conversion outcomes';



COMMENT ON COLUMN "public"."user_event_sequences"."event_sequence" IS 'Array of events: [{event, 
  time, creator, ...}]';



COMMENT ON COLUMN "public"."user_event_sequences"."total_copies" IS 'Total portfolio copies by this 
  user';



COMMENT ON COLUMN "public"."user_event_sequences"."total_subscriptions" IS 'Binary flag: 1 if user 
  has subscribed, 0 otherwise';



CREATE OR REPLACE VIEW "public"."user_portfolio_creator_copies" AS
 SELECT "distinct_id",
    "portfolio_ticker",
    "creator_id",
    "creator_username",
    "pdp_view_count",
    "copy_count",
    "liquidation_count",
    ("copy_count" > 0) AS "did_copy",
    "synced_at"
   FROM "public"."user_portfolio_creator_engagement";


ALTER VIEW "public"."user_portfolio_creator_copies" OWNER TO "postgres";


COMMENT ON VIEW "public"."user_portfolio_creator_copies" IS 'Portfolio-level copy 
  events';



CREATE SEQUENCE IF NOT EXISTS "public"."user_portfolio_creator_engagement_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_portfolio_creator_engagement_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_portfolio_creator_engagement_id_seq" OWNED BY "public"."user_portfolio_creator_engagement"."id";



CREATE OR REPLACE VIEW "public"."validation_aggregation_methods" AS
 SELECT "view_name",
    "metric_name",
    "aggregation_method",
    "source",
    "description"
   FROM ( VALUES ('premium_creator_breakdown'::"text",'total_copies'::"text",'SUM'::"text",'portfolio_creator_engagement_metrics'::"text",'Sum across all portfolios per creator'::"text"), ('premium_creator_breakdown'::"text",'total_pdp_views'::"text",'SUM'::"text",'portfolio_creator_engagement_metrics'::"text",'Sum across all portfolios per creator'::"text"), ('premium_creator_breakdown'::"text",'total_liquidations'::"text",'SUM'::"text",'portfolio_creator_engagement_metrics'::"text",'Sum across all portfolios per creator'::"text"), ('premium_creator_breakdown'::"text",'total_subscriptions'::"text",'MAX'::"text",'premium_creator_metrics'::"text",'MAX to avoid double-counting duplicate creator_ids'::"text"), ('premium_creator_breakdown'::"text",'total_paywall_views'::"text",'MAX'::"text",'premium_creator_metrics'::"text",'MAX to avoid double-counting duplicate creator_ids'::"text"), ('premium_creator_breakdown'::"text",'total_cancellations'::"text",'MAX'::"text",'premium_creator_metrics'::"text",'MAX to avoid double-counting duplicate creator_ids'::"text"), ('premium_creator_breakdown'::"text",'avg_all_time_returns'::"text",'AVG'::"text",'portfolio_performance_metrics'::"text",'Average returns across all portfolios'::"text"), ('premium_creator_breakdown'::"text",'total_copy_capital'::"text",'SUM'::"text",'portfolio_performance_metrics'::"text",'Total capital across all portfolios'::"text"), ('premium_creator_affinity_display'::"text",'premium_creator_total_copies'::"text",'SUM'::"text",'premium_creator_portfolio_metrics_latest'::"text",'Sum across all portfolios per creator'::"text"), ('premium_creator_affinity_display'::"text",'premium_creator_total_liquidations'::"text",'SUM'::"text",'premium_creator_portfolio_metrics_latest'::"text",'Sum across all portfolios per creator'::"text"), ('top_stocks_all_premium_creators'::"text",'total_quantity'::"text",'SUM'::"text",'premium_creator_stock_holdings'::"text",'Sum across all creators for each stock'::"text"), ('premium_creator_top_5_stocks'::"text",'top_stocks'::"text",'ARRAY_AGG'::"text",'premium_creator_stock_holdings'::"text",'Top 5 stocks per creator by quantity'::"text")) "t"("view_name", "metric_name", "aggregation_method", "source", "description");


ALTER VIEW "public"."validation_aggregation_methods" OWNER TO "postgres";


COMMENT ON VIEW "public"."validation_aggregation_methods" IS 'Documents the aggregation method used for each metric in each view. Reference this when debugging discrepancies.';



CREATE OR REPLACE VIEW "public"."validation_duplicate_creator_ids" AS
 SELECT "creator_username",
    "count"(DISTINCT "creator_id") AS "creator_id_count",
    "array_agg"(DISTINCT "creator_id" ORDER BY "creator_id") AS "creator_ids"
   FROM "public"."premium_creators"
  GROUP BY "creator_username"
 HAVING ("count"(DISTINCT "creator_id") > 1)
  ORDER BY ("count"(DISTINCT "creator_id")) DESC, "creator_username";


ALTER VIEW "public"."validation_duplicate_creator_ids" OWNER TO "postgres";


COMMENT ON VIEW "public"."validation_duplicate_creator_ids" IS 'Lists creators that have multiple creator_ids. These require special handling (MAX aggregation) to avoid double-counting.';



CREATE OR REPLACE VIEW "public"."validation_subscription_consistency" AS
 WITH "subscription_per_id" AS (
         SELECT "pc"."creator_username",
            "pc"."creator_id",
            "pcm"."total_subscriptions"
           FROM ("public"."premium_creators" "pc"
             LEFT JOIN "public"."premium_creator_metrics" "pcm" ON (("pc"."creator_id" = "pcm"."creator_id")))
        ), "grouped" AS (
         SELECT "subscription_per_id"."creator_username",
            "count"(DISTINCT "subscription_per_id"."creator_id") AS "creator_id_count",
            "count"(DISTINCT "subscription_per_id"."total_subscriptions") AS "unique_subscription_values",
            "array_agg"(DISTINCT "subscription_per_id"."total_subscriptions" ORDER BY "subscription_per_id"."total_subscriptions" DESC) AS "subscription_values"
           FROM "subscription_per_id"
          GROUP BY "subscription_per_id"."creator_username"
        )
 SELECT "creator_username",
    "creator_id_count",
    "unique_subscription_values",
    "subscription_values",
        CASE
            WHEN (("creator_id_count" > 1) AND ("unique_subscription_values" > 1)) THEN 'INCONSISTENT'::"text"
            WHEN (("creator_id_count" > 1) AND ("unique_subscription_values" = 1)) THEN 'Consistent'::"text"
            ELSE 'Single creator_id'::"text"
        END AS "status"
   FROM "grouped"
  WHERE ("creator_id_count" > 1)
  ORDER BY "unique_subscription_values" DESC, "creator_username";


ALTER VIEW "public"."validation_subscription_consistency" OWNER TO "postgres";


COMMENT ON VIEW "public"."validation_subscription_consistency" IS 'Checks if creators with multiple creator_ids have consistent subscription counts. INCONSISTENT status indicates data quality issue.';



CREATE OR REPLACE VIEW "public"."validation_view_freshness" AS
 SELECT "view_name",
    "last_refreshed_at",
    (EXTRACT(epoch FROM ("now"() - "last_refreshed_at")))::integer AS "seconds_since_refresh",
        CASE
            WHEN ("last_refreshed_at" IS NULL) THEN 'Never refreshed'::"text"
            WHEN (EXTRACT(epoch FROM ("now"() - "last_refreshed_at")) < (3600)::numeric) THEN 'Fresh (< 1 hour)'::"text"
            WHEN (EXTRACT(epoch FROM ("now"() - "last_refreshed_at")) < (86400)::numeric) THEN 'Moderate (< 1 day)'::"text"
            ELSE 'Stale (> 1 day)'::"text"
        END AS "freshness_status",
    "refresh_duration_ms",
    "rows_affected"
   FROM "public"."materialized_view_refresh_log"
  ORDER BY "last_refreshed_at" DESC NULLS LAST;


ALTER VIEW "public"."validation_view_freshness" OWNER TO "postgres";


COMMENT ON VIEW "public"."validation_view_freshness" IS 'Shows when each materialized view was last refreshed and how stale the data is. Use this to identify views that need refreshing.';



ALTER TABLE ONLY "public"."conversion_pattern_combinations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."conversion_pattern_combinations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."event_sequence_analysis" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."event_sequence_analysis_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."event_sequences_raw" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."event_sequences_raw_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."marketing_metrics" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."marketing_metrics_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."portfolio_creator_copy_metrics" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."portfolio_creator_copy_metrics_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."portfolio_stock_holdings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."portfolio_stock_holdings_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."premium_creator_metrics" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."premium_creator_metrics_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subscribers_insights" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subscribers_insights_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subscription_drivers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subscription_drivers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sync_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sync_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_portfolio_creator_engagement" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_portfolio_creator_engagement_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."business_assumptions"
    ADD CONSTRAINT "business_assumptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversion_pattern_combinations"
    ADD CONSTRAINT "conversion_pattern_combinations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."creator_subscriptions_by_price"
    ADD CONSTRAINT "creator_subscriptions_by_price_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."creator_subscriptions_by_price"
    ADD CONSTRAINT "creator_subscriptions_by_price_unique" UNIQUE ("creator_id", "subscription_price", "subscription_interval");



ALTER TABLE ONLY "public"."creator_subscriptions_by_price"
    ADD CONSTRAINT "creator_subscriptions_by_price_unique_key" UNIQUE ("creator_id", "subscription_price", "subscription_interval", "synced_at");



ALTER TABLE ONLY "public"."creators_insights"
    ADD CONSTRAINT "creators_insights_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."creators_insights"
    ADD CONSTRAINT "creators_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_sequence_analysis"
    ADD CONSTRAINT "event_sequence_analysis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_sequences_raw"
    ADD CONSTRAINT "event_sequences_raw_distinct_id_key" UNIQUE ("distinct_id");



ALTER TABLE ONLY "public"."event_sequences_raw"
    ADD CONSTRAINT "event_sequences_raw_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketing_metrics"
    ADD CONSTRAINT "marketing_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."materialized_view_refresh_log"
    ADD CONSTRAINT "materialized_view_refresh_log_pkey" PRIMARY KEY ("view_name");



ALTER TABLE ONLY "public"."portfolio_creator_copy_metrics"
    ADD CONSTRAINT "portfolio_creator_copy_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portfolio_creator_copy_metrics"
    ADD CONSTRAINT "portfolio_creator_copy_metrics_portfolio_ticker_creator_id_key" UNIQUE ("portfolio_ticker", "creator_id");



ALTER TABLE ONLY "public"."portfolio_performance_metrics"
    ADD CONSTRAINT "portfolio_performance_metrics_pkey" PRIMARY KEY ("portfolio_ticker");



ALTER TABLE ONLY "public"."portfolio_stock_holdings"
    ADD CONSTRAINT "portfolio_stock_holdings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portfolio_stock_holdings"
    ADD CONSTRAINT "portfolio_stock_holdings_portfolio_ticker_stock_ticker_key" UNIQUE ("portfolio_ticker", "stock_ticker");



ALTER TABLE ONLY "public"."premium_creator_metrics"
    ADD CONSTRAINT "premium_creator_metrics_creator_id_synced_at_key" UNIQUE ("creator_id", "synced_at");



ALTER TABLE ONLY "public"."premium_creator_metrics"
    ADD CONSTRAINT "premium_creator_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."premium_creator_retention_events"
    ADD CONSTRAINT "premium_creator_retention_events_pkey" PRIMARY KEY ("distinct_id", "creator_username", "cohort_month");



ALTER TABLE ONLY "public"."premium_creators"
    ADD CONSTRAINT "premium_creators_pkey" PRIMARY KEY ("creator_id");



ALTER TABLE ONLY "public"."subscribers_insights"
    ADD CONSTRAINT "subscribers_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscribers_insights"
    ADD CONSTRAINT "subscribers_insights_unique_key" UNIQUE ("distinct_id");



ALTER TABLE ONLY "public"."subscribers_insights_v2"
    ADD CONSTRAINT "subscribers_insights_v2_pkey" PRIMARY KEY ("distinct_id");



ALTER TABLE ONLY "public"."subscription_drivers"
    ADD CONSTRAINT "subscription_drivers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_drivers"
    ADD CONSTRAINT "subscription_drivers_variable_name_key" UNIQUE ("variable_name");



ALTER TABLE ONLY "public"."sync_logs"
    ADD CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscribers_insights"
    ADD CONSTRAINT "unique_distinct_id_per_sync" UNIQUE ("distinct_id", "synced_at");



ALTER TABLE ONLY "public"."user_creator_engagement"
    ADD CONSTRAINT "user_creator_engagement_pkey" PRIMARY KEY ("distinct_id", "creator_id");



ALTER TABLE ONLY "public"."user_event_sequences"
    ADD CONSTRAINT "user_event_sequences_pkey" PRIMARY KEY ("distinct_id");



ALTER TABLE ONLY "public"."user_portfolio_creator_engagement"
    ADD CONSTRAINT "user_portfolio_creator_engage_distinct_id_portfolio_ticker__key" UNIQUE ("distinct_id", "portfolio_ticker", "creator_id");



ALTER TABLE ONLY "public"."user_portfolio_creator_engagement"
    ADD CONSTRAINT "user_portfolio_creator_engagement_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_combinations_type_rank" ON "public"."conversion_pattern_combinations" USING "btree" ("analysis_type", "combination_rank");



CREATE INDEX "idx_creator_subscriptions_by_price_synced_at" ON "public"."creator_subscriptions_by_price" USING "btree" ("synced_at");



CREATE INDEX "idx_creators_insights_synced_at" ON "public"."creators_insights" USING "btree" ("synced_at");



CREATE INDEX "idx_creators_insights_total_leaderboard_views" ON "public"."creators_insights" USING "btree" ("total_leaderboard_views");



CREATE INDEX "idx_creators_insights_total_rebalances" ON "public"."creators_insights" USING "btree" ("total_rebalances");



CREATE INDEX "idx_creators_insights_total_sessions" ON "public"."creators_insights" USING "btree" ("total_sessions");



CREATE INDEX "idx_engagement_creator" ON "public"."user_portfolio_creator_engagement" USING "btree" ("creator_id");



CREATE INDEX "idx_engagement_distinct_id" ON "public"."user_portfolio_creator_engagement" USING "btree" ("distinct_id");



CREATE INDEX "idx_engagement_portfolio" ON "public"."user_portfolio_creator_engagement" USING "btree" ("portfolio_ticker");



CREATE INDEX "idx_event_sequence_analysis_type" ON "public"."event_sequence_analysis" USING "btree" ("analysis_type");



CREATE INDEX "idx_event_sequence_analysis_type_time" ON "public"."event_sequence_analysis" USING "btree" ("analysis_type", "generated_at" DESC);



CREATE INDEX "idx_event_sequences_raw_synced_at" ON "public"."event_sequences_raw" USING "btree" ("synced_at" DESC);



CREATE INDEX "idx_main_analysis_did_copy" ON "public"."main_analysis" USING "btree" ("did_copy");



CREATE INDEX "idx_main_analysis_did_subscribe" ON "public"."main_analysis" USING "btree" ("did_subscribe");



CREATE INDEX "idx_main_analysis_distinct_id" ON "public"."main_analysis" USING "btree" ("distinct_id");



CREATE INDEX "idx_main_analysis_total_copies" ON "public"."main_analysis" USING "btree" ("total_copies");



CREATE INDEX "idx_main_analysis_total_subscriptions" ON "public"."main_analysis" USING "btree" ("total_subscriptions");



CREATE INDEX "idx_mv_refresh_log_timestamp" ON "public"."materialized_view_refresh_log" USING "btree" ("last_refreshed_at" DESC);



CREATE INDEX "idx_portfolio_breakdown_creator" ON "public"."portfolio_breakdown_with_metrics" USING "btree" ("creator_id");



CREATE INDEX "idx_portfolio_breakdown_ticker" ON "public"."portfolio_breakdown_with_metrics" USING "btree" ("portfolio_ticker");



CREATE INDEX "idx_portfolio_creator_copy_metrics_creator" ON "public"."portfolio_creator_copy_metrics" USING "btree" ("creator_id");



CREATE INDEX "idx_portfolio_creator_copy_metrics_portfolio" ON "public"."portfolio_creator_copy_metrics" USING "btree" ("portfolio_ticker");



CREATE INDEX "idx_portfolio_creator_copy_metrics_username" ON "public"."portfolio_creator_copy_metrics" USING "btree" ("creator_username");



CREATE INDEX "idx_portfolio_creator_engagement_copies" ON "public"."portfolio_creator_engagement_metrics" USING "btree" ("total_copies" DESC);



CREATE INDEX "idx_portfolio_creator_engagement_liquidations" ON "public"."portfolio_creator_engagement_metrics" USING "btree" ("total_liquidations" DESC);



CREATE INDEX "idx_portfolio_creator_engagement_metrics_creator" ON "public"."portfolio_creator_engagement_metrics" USING "btree" ("creator_id");



CREATE INDEX "idx_portfolio_creator_engagement_metrics_ticker" ON "public"."portfolio_creator_engagement_metrics" USING "btree" ("portfolio_ticker");



CREATE INDEX "idx_portfolio_metrics_ticker" ON "public"."portfolio_performance_metrics" USING "btree" ("portfolio_ticker");



CREATE INDEX "idx_portfolio_stock_holdings_portfolio" ON "public"."portfolio_stock_holdings" USING "btree" ("portfolio_ticker");



CREATE INDEX "idx_portfolio_stock_holdings_quantity" ON "public"."portfolio_stock_holdings" USING "btree" ("total_quantity" DESC);



CREATE INDEX "idx_portfolio_stock_holdings_stock" ON "public"."portfolio_stock_holdings" USING "btree" ("stock_ticker");



CREATE INDEX "idx_premium_creator_metrics_creator" ON "public"."premium_creator_metrics" USING "btree" ("creator_id");



CREATE INDEX "idx_premium_creator_metrics_synced" ON "public"."premium_creator_metrics" USING "btree" ("synced_at" DESC);



CREATE INDEX "idx_premium_creator_stock_holdings_creator" ON "public"."premium_creator_stock_holdings" USING "btree" ("creator_username");



CREATE INDEX "idx_premium_creator_stock_holdings_quantity" ON "public"."premium_creator_stock_holdings" USING "btree" ("total_quantity" DESC);



CREATE INDEX "idx_premium_creator_stock_holdings_stock" ON "public"."premium_creator_stock_holdings" USING "btree" ("stock_ticker");



CREATE INDEX "idx_premium_creators_username" ON "public"."premium_creators" USING "btree" ("creator_username");



CREATE INDEX "idx_retention_analysis_creator" ON "public"."premium_creator_retention_analysis" USING "btree" ("creator_username");



CREATE INDEX "idx_retention_events_cohort" ON "public"."premium_creator_retention_events" USING "btree" ("cohort_date");



CREATE INDEX "idx_retention_events_creator" ON "public"."premium_creator_retention_events" USING "btree" ("creator_username");



CREATE INDEX "idx_retention_events_creator_cohort" ON "public"."premium_creator_retention_events" USING "btree" ("creator_username", "cohort_date");



CREATE INDEX "idx_subscribers_synced_at" ON "public"."subscribers_insights" USING "btree" ("synced_at" DESC);



CREATE INDEX "idx_subscribers_v2_distinct_id" ON "public"."subscribers_insights_v2" USING "btree" ("distinct_id");



CREATE INDEX "idx_subscribers_v2_total_copies" ON "public"."subscribers_insights_v2" USING "btree" ("total_copies") WHERE ("total_copies" > 0);



CREATE INDEX "idx_subscribers_v2_total_subscriptions" ON "public"."subscribers_insights_v2" USING "btree" ("total_subscriptions") WHERE ("total_subscriptions" > 0);



CREATE INDEX "idx_subscribers_v2_updated_at" ON "public"."subscribers_insights_v2" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_subscription_drivers_correlation" ON "public"."subscription_drivers" USING "btree" ("correlation_coefficient" DESC);



CREATE INDEX "idx_subscription_drivers_synced_at" ON "public"."subscription_drivers" USING "btree" ("synced_at" DESC);



CREATE INDEX "idx_sync_logs_started_at" ON "public"."sync_logs" USING "btree" ("sync_started_at" DESC);



CREATE INDEX "idx_sync_logs_tool_type_started" ON "public"."sync_logs" USING "btree" ("tool_type", "sync_started_at" DESC);



CREATE INDEX "idx_top_stocks_all_premium_creators_rank" ON "public"."top_stocks_all_premium_creators" USING "btree" ("rank");



CREATE INDEX "idx_uce_creator_id" ON "public"."user_creator_engagement" USING "btree" ("creator_id");



CREATE INDEX "idx_uce_subscription_count" ON "public"."user_creator_engagement" USING "btree" ("subscription_count") WHERE ("subscription_count" > 0);



CREATE INDEX "idx_uce_username" ON "public"."user_creator_engagement" USING "btree" ("creator_username");



CREATE INDEX "idx_upce_composite" ON "public"."user_portfolio_creator_engagement" USING "btree" ("distinct_id", "creator_id", "did_copy");



CREATE INDEX "idx_upce_creator_copy" ON "public"."user_portfolio_creator_engagement" USING "btree" ("creator_id", "did_copy", "distinct_id", "copy_count", "liquidation_count") WHERE ("did_copy" = true);



CREATE INDEX "idx_upce_creator_id" ON "public"."user_portfolio_creator_engagement" USING "btree" ("creator_id");



CREATE INDEX "idx_upce_did_copy" ON "public"."user_portfolio_creator_engagement" USING "btree" ("did_copy") WHERE ("did_copy" = true);



CREATE INDEX "idx_upce_distinct_copy" ON "public"."user_portfolio_creator_engagement" USING "btree" ("distinct_id", "did_copy", "creator_id", "creator_username", "copy_count") WHERE ("did_copy" = true);



CREATE INDEX "idx_upce_distinct_id" ON "public"."user_portfolio_creator_engagement" USING "btree" ("distinct_id");



CREATE INDEX "idx_user_creator_engagement_subscription" ON "public"."user_creator_engagement" USING "btree" ("creator_id", "subscription_count", "creator_username") WHERE ("subscription_count" > 0);



CREATE INDEX "idx_user_event_sequences_copies" ON "public"."user_event_sequences" USING "btree" ("total_copies");



CREATE INDEX "idx_user_event_sequences_distinct_id" ON "public"."user_event_sequences" USING "btree" ("distinct_id");



CREATE INDEX "idx_user_event_sequences_subscriptions" ON "public"."user_event_sequences" USING "btree" ("total_subscriptions");



CREATE OR REPLACE TRIGGER "calculate_sync_logs_duration" BEFORE UPDATE ON "public"."sync_logs" FOR EACH ROW EXECUTE FUNCTION "public"."calculate_sync_duration"();



CREATE OR REPLACE TRIGGER "ensure_single_row_trigger" BEFORE INSERT ON "public"."marketing_metrics" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_single_marketing_metrics_row"();



CREATE OR REPLACE TRIGGER "update_creators_insights_updated_at" BEFORE UPDATE ON "public"."creators_insights" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_event_sequences_raw_updated_at" BEFORE UPDATE ON "public"."event_sequences_raw" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_subscribers_insights_updated_at" BEFORE UPDATE ON "public"."subscribers_insights" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE POLICY "Allow anon full access to subscription_drivers" ON "public"."subscription_drivers" TO "anon" USING (true) WITH CHECK (true);



COMMENT ON POLICY "Allow anon full access to subscription_drivers" ON "public"."subscription_drivers" IS 'Allow client-side JavaScript to save subscription driver analysis results. This is safe because the data is derived from user analysis and not user-generated content.';



CREATE POLICY "Allow anonymous read access" ON "public"."business_assumptions" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow authenticated read access to subscribers_insights" ON "public"."subscribers_insights" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated read access to sync_logs" ON "public"."sync_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow public read access to event_sequence_analysis" ON "public"."event_sequence_analysis" FOR SELECT USING (true);



CREATE POLICY "Allow service role full access" ON "public"."business_assumptions" TO "service_role" USING (true);



CREATE POLICY "Allow service role full access to subscribers_insights" ON "public"."subscribers_insights" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Allow service role full access to subscription_drivers" ON "public"."subscription_drivers" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Allow service role full access to sync_logs" ON "public"."sync_logs" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."business_assumptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_sequence_analysis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscribers_insights" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_drivers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_logs" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."calculate_sync_duration"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_sync_duration"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_sync_duration"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_single_marketing_metrics_row"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_single_marketing_metrics_row"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_single_marketing_metrics_row"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_distinct_creator_usernames"("creator_ids" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_distinct_creator_usernames"("creator_ids" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_distinct_creator_usernames"("creator_ids" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_last_portfolio_event_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_last_portfolio_event_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_last_portfolio_event_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_last_successful_sync_time"("source_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_last_successful_sync_time"("source_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_last_successful_sync_time"("source_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_materialized_view_refresh"("p_view_name" "text", "p_refresh_duration_ms" integer, "p_rows_affected" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."log_materialized_view_refresh"("p_view_name" "text", "p_refresh_duration_ms" integer, "p_rows_affected" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_materialized_view_refresh"("p_view_name" "text", "p_refresh_duration_ms" integer, "p_rows_affected" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_all_premium_creator_views"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_all_premium_creator_views"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_all_premium_creator_views"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_copy_engagement_summary"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_copy_engagement_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_copy_engagement_summary"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_creator_analysis"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_creator_analysis"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_creator_analysis"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_hidden_gems"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_hidden_gems"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_hidden_gems"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_hidden_gems_portfolios"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_hidden_gems_portfolios"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_hidden_gems_portfolios"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_latest_sync_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_latest_sync_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_latest_sync_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_main_analysis"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_main_analysis"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_main_analysis"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_portfolio_breakdown_view"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_portfolio_breakdown_view"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_portfolio_breakdown_view"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_portfolio_creator_engagement_metrics"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_portfolio_creator_engagement_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_portfolio_creator_engagement_metrics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_portfolio_engagement_views"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_portfolio_engagement_views"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_portfolio_engagement_views"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_premium_creator_breakdown_view"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_premium_creator_breakdown_view"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_premium_creator_breakdown_view"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_premium_creator_stock_holdings_view"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_premium_creator_stock_holdings_view"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_premium_creator_stock_holdings_view"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_premium_creator_top_5_stocks_view"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_premium_creator_top_5_stocks_view"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_premium_creator_top_5_stocks_view"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_premium_creator_views_json"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_premium_creator_views_json"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_premium_creator_views_json"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_subscription_engagement_summary"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_subscription_engagement_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_subscription_engagement_summary"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_top_stocks_all_premium_creators_view"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_top_stocks_all_premium_creators_view"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_top_stocks_all_premium_creators_view"() TO "service_role";



GRANT ALL ON FUNCTION "public"."run_all_validations"() TO "anon";
GRANT ALL ON FUNCTION "public"."run_all_validations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."run_all_validations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_creators_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_creators_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_creators_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upload_creator_data"("creator_data" "jsonb"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."upload_creator_data"("creator_data" "jsonb"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upload_creator_data"("creator_data" "jsonb"[]) TO "service_role";


















GRANT ALL ON TABLE "public"."business_assumptions" TO "anon";
GRANT ALL ON TABLE "public"."business_assumptions" TO "authenticated";
GRANT ALL ON TABLE "public"."business_assumptions" TO "service_role";



GRANT ALL ON TABLE "public"."conversion_pattern_combinations" TO "anon";
GRANT ALL ON TABLE "public"."conversion_pattern_combinations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversion_pattern_combinations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."conversion_pattern_combinations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."conversion_pattern_combinations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."conversion_pattern_combinations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscribers_insights" TO "anon";
GRANT ALL ON TABLE "public"."subscribers_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."subscribers_insights" TO "service_role";



GRANT ALL ON TABLE "public"."user_portfolio_creator_engagement" TO "anon";
GRANT ALL ON TABLE "public"."user_portfolio_creator_engagement" TO "authenticated";
GRANT ALL ON TABLE "public"."user_portfolio_creator_engagement" TO "service_role";



GRANT ALL ON TABLE "public"."main_analysis" TO "anon";
GRANT ALL ON TABLE "public"."main_analysis" TO "authenticated";
GRANT ALL ON TABLE "public"."main_analysis" TO "service_role";



GRANT ALL ON TABLE "public"."copy_engagement_summary" TO "anon";
GRANT ALL ON TABLE "public"."copy_engagement_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."copy_engagement_summary" TO "service_role";



GRANT ALL ON TABLE "public"."creator_subscriptions_by_price" TO "anon";
GRANT ALL ON TABLE "public"."creator_subscriptions_by_price" TO "authenticated";
GRANT ALL ON TABLE "public"."creator_subscriptions_by_price" TO "service_role";



GRANT ALL ON SEQUENCE "public"."creator_subscriptions_by_price_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."creator_subscriptions_by_price_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."creator_subscriptions_by_price_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."creators_insights" TO "anon";
GRANT ALL ON TABLE "public"."creators_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."creators_insights" TO "service_role";



GRANT ALL ON SEQUENCE "public"."creators_insights_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."creators_insights_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."creators_insights_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."event_sequence_analysis" TO "anon";
GRANT ALL ON TABLE "public"."event_sequence_analysis" TO "authenticated";
GRANT ALL ON TABLE "public"."event_sequence_analysis" TO "service_role";



GRANT ALL ON SEQUENCE "public"."event_sequence_analysis_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."event_sequence_analysis_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."event_sequence_analysis_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."event_sequences_raw" TO "anon";
GRANT ALL ON TABLE "public"."event_sequences_raw" TO "authenticated";
GRANT ALL ON TABLE "public"."event_sequences_raw" TO "service_role";



GRANT ALL ON SEQUENCE "public"."event_sequences_raw_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."event_sequences_raw_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."event_sequences_raw_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_creator_engagement_metrics" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_creator_engagement_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_creator_engagement_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."hidden_gems_portfolios" TO "anon";
GRANT ALL ON TABLE "public"."hidden_gems_portfolios" TO "authenticated";
GRANT ALL ON TABLE "public"."hidden_gems_portfolios" TO "service_role";



GRANT ALL ON TABLE "public"."latest_subscription_distribution" TO "anon";
GRANT ALL ON TABLE "public"."latest_subscription_distribution" TO "authenticated";
GRANT ALL ON TABLE "public"."latest_subscription_distribution" TO "service_role";



GRANT ALL ON TABLE "public"."marketing_metrics" TO "anon";
GRANT ALL ON TABLE "public"."marketing_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."marketing_metrics" TO "service_role";



GRANT ALL ON SEQUENCE "public"."marketing_metrics_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."marketing_metrics_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."marketing_metrics_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."materialized_view_refresh_log" TO "anon";
GRANT ALL ON TABLE "public"."materialized_view_refresh_log" TO "authenticated";
GRANT ALL ON TABLE "public"."materialized_view_refresh_log" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_performance_metrics" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_performance_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_performance_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creators" TO "anon";
GRANT ALL ON TABLE "public"."premium_creators" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creators" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_breakdown_with_metrics" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_breakdown_with_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_breakdown_with_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_creator_copy_metrics" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_creator_copy_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_creator_copy_metrics" TO "service_role";



GRANT ALL ON SEQUENCE "public"."portfolio_creator_copy_metrics_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."portfolio_creator_copy_metrics_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."portfolio_creator_copy_metrics_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_stock_holdings" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_stock_holdings" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_stock_holdings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."portfolio_stock_holdings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."portfolio_stock_holdings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."portfolio_stock_holdings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creator_copy_affinity_base" TO "anon";
GRANT ALL ON TABLE "public"."premium_creator_copy_affinity_base" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creator_copy_affinity_base" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creator_affinity_display" TO "anon";
GRANT ALL ON TABLE "public"."premium_creator_affinity_display" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creator_affinity_display" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creator_metrics" TO "anon";
GRANT ALL ON TABLE "public"."premium_creator_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creator_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creator_breakdown" TO "anon";
GRANT ALL ON TABLE "public"."premium_creator_breakdown" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creator_breakdown" TO "service_role";



GRANT ALL ON SEQUENCE "public"."premium_creator_metrics_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."premium_creator_metrics_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."premium_creator_metrics_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creator_metrics_latest" TO "anon";
GRANT ALL ON TABLE "public"."premium_creator_metrics_latest" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creator_metrics_latest" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creator_retention_events" TO "anon";
GRANT ALL ON TABLE "public"."premium_creator_retention_events" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creator_retention_events" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creator_retention_analysis" TO "anon";
GRANT ALL ON TABLE "public"."premium_creator_retention_analysis" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creator_retention_analysis" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creator_stock_holdings" TO "anon";
GRANT ALL ON TABLE "public"."premium_creator_stock_holdings" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creator_stock_holdings" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creator_summary_stats" TO "anon";
GRANT ALL ON TABLE "public"."premium_creator_summary_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creator_summary_stats" TO "service_role";



GRANT ALL ON TABLE "public"."premium_creator_top_5_stocks" TO "anon";
GRANT ALL ON TABLE "public"."premium_creator_top_5_stocks" TO "authenticated";
GRANT ALL ON TABLE "public"."premium_creator_top_5_stocks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subscribers_insights_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subscribers_insights_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subscribers_insights_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscribers_insights_v2" TO "anon";
GRANT ALL ON TABLE "public"."subscribers_insights_v2" TO "authenticated";
GRANT ALL ON TABLE "public"."subscribers_insights_v2" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_drivers" TO "anon";
GRANT ALL ON TABLE "public"."subscription_drivers" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_drivers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subscription_drivers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subscription_drivers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subscription_drivers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_engagement_summary" TO "anon";
GRANT ALL ON TABLE "public"."subscription_engagement_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_engagement_summary" TO "service_role";



GRANT ALL ON TABLE "public"."sync_logs" TO "anon";
GRANT ALL ON TABLE "public"."sync_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sync_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sync_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sync_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."top_stocks_all_premium_creators" TO "anon";
GRANT ALL ON TABLE "public"."top_stocks_all_premium_creators" TO "authenticated";
GRANT ALL ON TABLE "public"."top_stocks_all_premium_creators" TO "service_role";



GRANT ALL ON TABLE "public"."user_creator_engagement" TO "anon";
GRANT ALL ON TABLE "public"."user_creator_engagement" TO "authenticated";
GRANT ALL ON TABLE "public"."user_creator_engagement" TO "service_role";



GRANT ALL ON TABLE "public"."user_creator_profile_copies" TO "anon";
GRANT ALL ON TABLE "public"."user_creator_profile_copies" TO "authenticated";
GRANT ALL ON TABLE "public"."user_creator_profile_copies" TO "service_role";



GRANT ALL ON TABLE "public"."user_event_sequences" TO "anon";
GRANT ALL ON TABLE "public"."user_event_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_event_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."user_portfolio_creator_copies" TO "anon";
GRANT ALL ON TABLE "public"."user_portfolio_creator_copies" TO "authenticated";
GRANT ALL ON TABLE "public"."user_portfolio_creator_copies" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_portfolio_creator_engagement_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_portfolio_creator_engagement_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_portfolio_creator_engagement_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."validation_aggregation_methods" TO "anon";
GRANT ALL ON TABLE "public"."validation_aggregation_methods" TO "authenticated";
GRANT ALL ON TABLE "public"."validation_aggregation_methods" TO "service_role";



GRANT ALL ON TABLE "public"."validation_duplicate_creator_ids" TO "anon";
GRANT ALL ON TABLE "public"."validation_duplicate_creator_ids" TO "authenticated";
GRANT ALL ON TABLE "public"."validation_duplicate_creator_ids" TO "service_role";



GRANT ALL ON TABLE "public"."validation_subscription_consistency" TO "anon";
GRANT ALL ON TABLE "public"."validation_subscription_consistency" TO "authenticated";
GRANT ALL ON TABLE "public"."validation_subscription_consistency" TO "service_role";



GRANT ALL ON TABLE "public"."validation_view_freshness" TO "anon";
GRANT ALL ON TABLE "public"."validation_view_freshness" TO "authenticated";
GRANT ALL ON TABLE "public"."validation_view_freshness" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































RESET ALL;

  create policy "Service role can manage files w1mblg_0"
  on "storage"."objects"
  as permissive
  for select
  to service_role
using ((bucket_id = 'mixpanel-raw-data'::text));



  create policy "Service role can manage files w1mblg_1"
  on "storage"."objects"
  as permissive
  for insert
  to service_role
with check ((bucket_id = 'mixpanel-raw-data'::text));



  create policy "Service role can manage files w1mblg_2"
  on "storage"."objects"
  as permissive
  for update
  to service_role
using ((bucket_id = 'mixpanel-raw-data'::text));



  create policy "Service role can manage files w1mblg_3"
  on "storage"."objects"
  as permissive
  for delete
  to service_role
using ((bucket_id = 'mixpanel-raw-data'::text));



