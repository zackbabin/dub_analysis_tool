-- Drop portfolio_ticker_mapping table as it's no longer needed
-- We now get portfolio_ticker directly from the CSV file

DROP TABLE IF EXISTS portfolio_ticker_mapping CASCADE;
