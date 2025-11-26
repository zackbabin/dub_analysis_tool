-- Migration: Create deposit_drivers and copy_drivers tables
-- Purpose: Store pre-computed behavioral driver analysis results
-- These tables follow the same pattern as subscription_drivers

-- Create deposit_drivers table (mirrors subscription_drivers structure)
CREATE TABLE IF NOT EXISTS deposit_drivers (
    id BIGSERIAL PRIMARY KEY,
    variable_name TEXT NOT NULL,
    correlation_coefficient NUMERIC NOT NULL,
    t_stat NUMERIC NOT NULL,
    tipping_point TEXT,
    predictive_strength TEXT,
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create copy_drivers table (mirrors subscription_drivers structure)
CREATE TABLE IF NOT EXISTS copy_drivers (
    id BIGSERIAL PRIMARY KEY,
    variable_name TEXT NOT NULL,
    correlation_coefficient NUMERIC NOT NULL,
    t_stat NUMERIC NOT NULL,
    tipping_point TEXT,
    predictive_strength TEXT,
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_deposit_drivers_synced_at ON deposit_drivers(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_copy_drivers_synced_at ON copy_drivers(synced_at DESC);

-- Grant permissions
GRANT SELECT ON deposit_drivers TO authenticated, anon, service_role;
GRANT SELECT ON copy_drivers TO authenticated, anon, service_role;

-- Add comments
COMMENT ON TABLE deposit_drivers IS 'Pre-computed behavioral drivers for deposit conversions. Updated during sync workflow via analyze-behavioral-drivers edge function.';
COMMENT ON TABLE copy_drivers IS 'Pre-computed behavioral drivers for portfolio copy conversions. Updated during sync workflow via analyze-behavioral-drivers edge function.';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Created behavioral drivers tables';
  RAISE NOTICE '   - deposit_drivers: stores deposit conversion drivers';
  RAISE NOTICE '   - copy_drivers: stores portfolio copy conversion drivers';
  RAISE NOTICE '   - Both follow same structure as subscription_drivers';
  RAISE NOTICE '';
END $$;
