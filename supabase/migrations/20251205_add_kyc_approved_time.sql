-- Migration: Add kyc_approved_time to user_first_copies
-- Created: 2025-12-05
-- Purpose: Add KYC approved timestamp to enable time-bounded copy conversion path analysis

-- ===========================================
-- 1. Add kyc_approved_time column
-- ===========================================

ALTER TABLE user_first_copies
ADD COLUMN kyc_approved_time TIMESTAMPTZ;

-- Add index for filtering users with both timestamps
CREATE INDEX idx_user_first_copies_both_timestamps
ON user_first_copies(user_id)
WHERE first_copy_time IS NOT NULL AND kyc_approved_time IS NOT NULL;

-- ===========================================
-- 2. Log Migration
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added kyc_approved_time column to user_first_copies';
  RAISE NOTICE '   - Column: kyc_approved_time (TIMESTAMPTZ, nullable)';
  RAISE NOTICE '   - Index: idx_user_first_copies_both_timestamps (for users with both timestamps)';
  RAISE NOTICE '';
END $$;
