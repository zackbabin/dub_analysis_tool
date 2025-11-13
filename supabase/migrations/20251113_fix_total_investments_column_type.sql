-- Fix total_investments column to handle decimal values
-- Date: 2025-11-13

ALTER TABLE public.marketing_metrics
ALTER COLUMN total_investments TYPE NUMERIC(15, 2);
