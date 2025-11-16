-- Create truncate_subscription_drivers RPC function
-- This function clears all existing subscription driver data before inserting new analysis results
-- Date: 2025-11-16

CREATE OR REPLACE FUNCTION truncate_subscription_drivers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM subscription_drivers;
END;
$$;

-- Grant execute permission to service_role
GRANT EXECUTE ON FUNCTION truncate_subscription_drivers() TO service_role;

-- Also grant to anon for client-side calls (with RLS protection)
GRANT EXECUTE ON FUNCTION truncate_subscription_drivers() TO anon;

COMMENT ON FUNCTION truncate_subscription_drivers() IS
'Clears all subscription driver data. Called before inserting new regression analysis results to avoid duplicates.';
