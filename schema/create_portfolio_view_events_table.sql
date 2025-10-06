-- Create table for storing "Viewed Portfolio Details" events
-- This replaces the Mixpanel Event Export API calls in analyze-portfolio-sequences

CREATE TABLE IF NOT EXISTS portfolio_view_events (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    distinct_id text NOT NULL,
    portfolio_ticker text NOT NULL,
    event_time bigint NOT NULL,  -- Unix timestamp from Mixpanel (event.properties.time)
    synced_at timestamp with time zone NOT NULL DEFAULT NOW(),

    -- Add index for efficient querying by user and time
    CONSTRAINT portfolio_view_events_unique_key
    UNIQUE (distinct_id, portfolio_ticker, event_time)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_portfolio_view_events_distinct_id
    ON portfolio_view_events(distinct_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_view_events_time
    ON portfolio_view_events(event_time);

CREATE INDEX IF NOT EXISTS idx_portfolio_view_events_synced_at
    ON portfolio_view_events(synced_at DESC);

-- Comment for documentation
COMMENT ON TABLE portfolio_view_events IS
'Stores raw "Viewed Portfolio Details" events from Mixpanel for portfolio sequence analysis.
Each row represents one portfolio view event with the original Mixpanel timestamp preserved.';

COMMENT ON COLUMN portfolio_view_events.event_time IS
'Unix timestamp from Mixpanel event.properties.time - used for chronological sorting';

COMMENT ON COLUMN portfolio_view_events.synced_at IS
'Timestamp when this event was synced from Mixpanel to Supabase';
