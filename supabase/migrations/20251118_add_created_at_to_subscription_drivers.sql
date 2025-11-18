-- Add created_at column to subscription_drivers table
-- This column is used by the upsert_subscription_drivers function
-- Date: 2025-11-18

ALTER TABLE public.subscription_drivers
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN public.subscription_drivers.created_at IS 'Timestamp of when this record was first created';
