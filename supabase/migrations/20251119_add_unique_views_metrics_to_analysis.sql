-- Migration: Add unique views metrics to event_sequence_analysis table
-- Created: 2025-11-19
-- Purpose: Add columns for avg unique portfolios and creators viewed before conversion

-- Add columns for unique views metrics
ALTER TABLE event_sequence_analysis
ADD COLUMN IF NOT EXISTS avg_unique_portfolios_viewed_before_copy NUMERIC,
ADD COLUMN IF NOT EXISTS avg_unique_creators_viewed_before_copy NUMERIC;

-- Add comments
COMMENT ON COLUMN event_sequence_analysis.avg_unique_portfolios_viewed_before_copy IS 'Average number of unique portfolios (distinct portfolioTicker) viewed by converters before first copy';
COMMENT ON COLUMN event_sequence_analysis.avg_unique_creators_viewed_before_copy IS 'Average number of unique creator profiles (distinct creatorUsername) viewed by converters before first copy';
