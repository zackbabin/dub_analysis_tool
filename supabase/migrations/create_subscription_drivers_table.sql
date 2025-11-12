-- Create table to store subscription regression/correlation results
-- This allows the creator analysis tool to display Top Subscription Drivers
-- without needing to recalculate the regression analysis

CREATE TABLE IF NOT EXISTS public.subscription_drivers (
    id BIGSERIAL PRIMARY KEY,
    variable_name TEXT NOT NULL,
    correlation_coefficient DECIMAL NOT NULL,
    t_stat DECIMAL NOT NULL,
    tipping_point TEXT,
    predictive_strength TEXT,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(variable_name)
);

-- Index for faster queries ordered by correlation
CREATE INDEX IF NOT EXISTS idx_subscription_drivers_correlation
ON public.subscription_drivers(correlation_coefficient DESC);

-- Index for querying by sync time
CREATE INDEX IF NOT EXISTS idx_subscription_drivers_synced_at
ON public.subscription_drivers(synced_at DESC);

-- Add RLS policies
ALTER TABLE public.subscription_drivers ENABLE ROW LEVEL SECURITY;

-- Allow anon to read
CREATE POLICY "Allow anon to read subscription_drivers"
ON public.subscription_drivers
FOR SELECT
TO anon
USING (true);

-- Allow service role to do everything
CREATE POLICY "Allow service role full access to subscription_drivers"
ON public.subscription_drivers
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON TABLE public.subscription_drivers IS 'Stores regression analysis results for subscription prediction. Updated during user analysis sync workflow.';
COMMENT ON COLUMN public.subscription_drivers.variable_name IS 'Event or behavior variable name (e.g., "profile_views", "pdp_views")';
COMMENT ON COLUMN public.subscription_drivers.correlation_coefficient IS 'Correlation coefficient with subscription outcome';
COMMENT ON COLUMN public.subscription_drivers.t_stat IS 'T-statistic from logistic regression';
COMMENT ON COLUMN public.subscription_drivers.tipping_point IS 'The threshold value where conversion rate significantly increases';
COMMENT ON COLUMN public.subscription_drivers.predictive_strength IS 'Categorized strength: Very Strong, Strong, Moderate-Strong, etc.';
COMMENT ON COLUMN public.subscription_drivers.synced_at IS 'Timestamp of when this data was last updated';
