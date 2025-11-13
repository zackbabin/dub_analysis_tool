-- Verify and fix marketing_metrics table setup
-- Date: 2025-11-12

-- First, completely drop and recreate the table to ensure clean state
DROP TABLE IF EXISTS public.marketing_metrics CASCADE;

-- Recreate table without RLS
CREATE TABLE public.marketing_metrics (
    id BIGSERIAL PRIMARY KEY,
    avg_monthly_copies INTEGER,
    total_investments INTEGER,
    total_public_portfolios INTEGER,
    total_market_beating_portfolios INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NO RLS - table is completely open
-- Grant all permissions to anon and authenticated
GRANT ALL ON public.marketing_metrics TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE marketing_metrics_id_seq TO anon, authenticated, service_role;

-- Recreate trigger for single row enforcement
CREATE OR REPLACE FUNCTION ensure_single_marketing_metrics_row()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM public.marketing_metrics;
    RETURN NEW;
END;
$$;

CREATE TRIGGER ensure_single_row_trigger
BEFORE INSERT ON public.marketing_metrics
FOR EACH ROW
EXECUTE FUNCTION ensure_single_marketing_metrics_row();

COMMENT ON TABLE marketing_metrics IS
'Marketing metrics table (no RLS). Contains public aggregate metrics for marketing dashboard. Single row enforced by trigger.';
