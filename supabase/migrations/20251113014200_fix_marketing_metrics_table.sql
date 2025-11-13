-- Fix marketing_metrics table - simple approach matching other working tables
-- Date: 2025-11-13

-- Drop existing table and recreate cleanly
DROP TABLE IF EXISTS public.marketing_metrics CASCADE;

-- Create simple table (no triggers, single row enforced by client code)
CREATE TABLE public.marketing_metrics (
    id BIGSERIAL PRIMARY KEY,
    avg_monthly_copies INTEGER,
    total_investments INTEGER,
    total_public_portfolios INTEGER,
    total_market_beating_portfolios INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Disable RLS entirely for this public metrics table
ALTER TABLE public.marketing_metrics DISABLE ROW LEVEL SECURITY;

-- Grant permissions to anon role (used by client)
GRANT ALL ON public.marketing_metrics TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE marketing_metrics_id_seq TO anon, authenticated, service_role;
