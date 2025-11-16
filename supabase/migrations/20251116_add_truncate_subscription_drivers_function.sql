-- Create truncate_subscription_drivers RPC function
-- This function clears all existing subscription driver data before inserting new analysis results
-- Date: 2025-11-16

CREATE OR REPLACE FUNCTION truncate_subscription_drivers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete with explicit schema to bypass RLS
  DELETE FROM public.subscription_drivers;
END;
$$;

-- Grant execute permission to all roles
GRANT EXECUTE ON FUNCTION truncate_subscription_drivers() TO service_role, authenticated, anon;

COMMENT ON FUNCTION truncate_subscription_drivers() IS
'Clears all subscription driver data. Called before inserting new regression analysis results to avoid duplicates.';
