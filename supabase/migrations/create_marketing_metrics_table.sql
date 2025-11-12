-- Create table to store marketing metrics
-- Stores key platform metrics for marketing and growth tracking

CREATE TABLE IF NOT EXISTS public.marketing_metrics (
    id BIGSERIAL PRIMARY KEY,
    avg_monthly_copies INTEGER,
    total_investments INTEGER,
    total_public_portfolios INTEGER,
    total_market_beating_portfolios INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only keep the most recent record (single row table)
-- Create a trigger to ensure only one row exists
CREATE OR REPLACE FUNCTION ensure_single_marketing_metrics_row()
RETURNS TRIGGER AS $$
BEGIN
    -- Delete all existing rows before insert
    DELETE FROM public.marketing_metrics;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_row_trigger
BEFORE INSERT ON public.marketing_metrics
FOR EACH ROW
EXECUTE FUNCTION ensure_single_marketing_metrics_row();

-- Add RLS policies
ALTER TABLE public.marketing_metrics ENABLE ROW LEVEL SECURITY;

-- Allow anon to read
CREATE POLICY "Allow anon to read marketing_metrics"
ON public.marketing_metrics
FOR SELECT
TO anon
USING (true);

-- Allow anon to insert/update (client-side updates)
CREATE POLICY "Allow anon to modify marketing_metrics"
ON public.marketing_metrics
FOR ALL
TO anon
USING (true)
WITH CHECK (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access to marketing_metrics"
ON public.marketing_metrics
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.marketing_metrics TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.marketing_metrics_id_seq TO anon, authenticated;

COMMENT ON TABLE public.marketing_metrics IS 'Stores marketing and growth metrics. Single-row table that maintains only the most recent values.';
COMMENT ON COLUMN public.marketing_metrics.avg_monthly_copies IS 'Average monthly copies from Mixpanel chart 86100814 (excluding current incomplete month)';
COMMENT ON COLUMN public.marketing_metrics.total_investments IS 'Total investments (placeholder for future implementation)';
COMMENT ON COLUMN public.marketing_metrics.total_public_portfolios IS 'Count of unique public portfolios from uploaded CSV data';
COMMENT ON COLUMN public.marketing_metrics.total_market_beating_portfolios IS 'Count of portfolios beating market benchmarks (placeholder for future implementation)';
COMMENT ON COLUMN public.marketing_metrics.updated_at IS 'Timestamp of last update';
