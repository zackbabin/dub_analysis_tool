-- Fix subscription_drivers to use UPSERT instead of truncate+insert
-- This avoids duplicate key errors and race conditions
-- Date: 2025-11-17

-- Drop the problematic truncate function
DROP FUNCTION IF EXISTS truncate_subscription_drivers();

-- Create an upsert function instead
CREATE OR REPLACE FUNCTION upsert_subscription_drivers(drivers jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Use INSERT ... ON CONFLICT DO UPDATE to avoid duplicates
  INSERT INTO public.subscription_drivers (
    variable_name,
    correlation_coefficient,
    t_stat,
    tipping_point,
    predictive_strength,
    created_at
  )
  SELECT
    (value->>'variable_name')::text,
    (value->>'correlation_coefficient')::numeric,
    (value->>'t_stat')::numeric,
    (value->>'tipping_point')::numeric,
    (value->>'predictive_strength')::text,
    now()
  FROM jsonb_array_elements(drivers)
  ON CONFLICT (variable_name) DO UPDATE SET
    correlation_coefficient = EXCLUDED.correlation_coefficient,
    t_stat = EXCLUDED.t_stat,
    tipping_point = EXCLUDED.tipping_point,
    predictive_strength = EXCLUDED.predictive_strength,
    created_at = EXCLUDED.created_at;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION upsert_subscription_drivers(jsonb) TO service_role, authenticated, anon;

COMMENT ON FUNCTION upsert_subscription_drivers(jsonb) IS
'Upserts subscription driver data. Updates existing records or inserts new ones to avoid duplicates.';
