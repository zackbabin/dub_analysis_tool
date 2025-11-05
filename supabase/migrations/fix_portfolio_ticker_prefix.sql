-- Add "$" prefix to portfolio_ticker values that don't already have it
UPDATE portfolio_ticker_mapping
SET portfolio_ticker = '$' || portfolio_ticker
WHERE portfolio_ticker NOT LIKE '$%';
