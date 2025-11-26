-- Ensure event_sequence_metrics has initial row
-- The row might be missing if migrations ran out of order

INSERT INTO event_sequence_metrics (id, mean_unique_portfolios, median_unique_portfolios)
VALUES (1, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE event_sequence_metrics IS
'Single-row table storing metrics from analyze-event-sequences Edge Function. Always has exactly one row with id=1.';
