-- Update subscription_drivers table comment
-- Now calculated via analyze-behavioral-drivers edge function (same as deposits/copies)

COMMENT ON TABLE public.subscription_drivers IS 'Pre-computed behavioral drivers for subscription conversions. Updated during sync workflow via analyze-behavioral-drivers edge function.';
