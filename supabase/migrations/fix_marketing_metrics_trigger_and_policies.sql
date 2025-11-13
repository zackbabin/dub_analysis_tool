-- Fix marketing_metrics trigger and RLS policies
-- Issues:
-- 1. Trigger DELETE fails with RLS (needs SECURITY DEFINER)
-- 2. RLS policies too restrictive (406 Not Acceptable)
-- Date: 2025-11-12

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS ensure_single_row_trigger ON public.marketing_metrics;
DROP FUNCTION IF EXISTS ensure_single_marketing_metrics_row();

-- Recreate trigger function with SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION ensure_single_marketing_metrics_row()
RETURNS TRIGGER
SECURITY DEFINER  -- Bypass RLS for this function
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    -- Delete all existing rows
    DELETE FROM public.marketing_metrics;
    RETURN NEW;
END;
$$;

-- Recreate trigger
CREATE TRIGGER ensure_single_row_trigger
BEFORE INSERT ON public.marketing_metrics
FOR EACH ROW
EXECUTE FUNCTION ensure_single_marketing_metrics_row();

-- Drop all existing policies
DROP POLICY IF EXISTS "Allow anon full access to marketing_metrics" ON public.marketing_metrics;
DROP POLICY IF EXISTS "Allow anon to read marketing_metrics" ON public.marketing_metrics;
DROP POLICY IF EXISTS "Allow anon to insert marketing_metrics" ON public.marketing_metrics;
DROP POLICY IF EXISTS "Allow anon to update marketing_metrics" ON public.marketing_metrics;
DROP POLICY IF EXISTS "Allow anon to delete marketing_metrics" ON public.marketing_metrics;

-- Create simpler, more permissive policies
CREATE POLICY "Allow anon to read marketing_metrics"
ON public.marketing_metrics
FOR SELECT
TO anon
USING (true);

CREATE POLICY "Allow anon to insert marketing_metrics"
ON public.marketing_metrics
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Allow anon to update marketing_metrics"
ON public.marketing_metrics
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anon to delete marketing_metrics"
ON public.marketing_metrics
FOR DELETE
TO anon
USING (true);

-- Ensure anon role has necessary permissions
GRANT ALL ON public.marketing_metrics TO anon;
GRANT USAGE, SELECT ON SEQUENCE marketing_metrics_id_seq TO anon;

COMMENT ON FUNCTION ensure_single_marketing_metrics_row() IS
'Ensures only one row exists in marketing_metrics table by deleting all rows before insert. Uses SECURITY DEFINER to bypass RLS.';
