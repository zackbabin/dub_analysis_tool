-- Fix marketing_metrics columns to support decimal values and larger integers
-- Change total_investments from INTEGER to NUMERIC to support cents (decimal values)
-- Change count columns from INTEGER to BIGINT for larger values
-- Date: 2025-11-14

ALTER TABLE public.marketing_metrics
ALTER COLUMN avg_monthly_copies TYPE BIGINT,
ALTER COLUMN total_investments TYPE NUMERIC(15,2),  -- Support up to $9,999,999,999,999.99
ALTER COLUMN total_public_portfolios TYPE BIGINT,
ALTER COLUMN total_market_beating_portfolios TYPE BIGINT;

-- Verify the changes
SELECT column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'marketing_metrics'
AND column_name IN ('avg_monthly_copies', 'total_investments', 'total_public_portfolios', 'total_market_beating_portfolios')
ORDER BY column_name;
