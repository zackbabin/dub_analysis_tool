-- Migration: Clean up old analysis types from copy path tables
-- Created: 2025-12-04
-- Purpose: Remove obsolete analysis_type rows after function update
--
-- Removes:
-- - first_portfolio (replaced by top_portfolios_viewed)
-- - last_portfolio (not used, removed)
-- - first_creator (replaced by top_creators_viewed)
-- - last_creator (not used, removed)

-- Delete old portfolio analysis types
DELETE FROM portfolio_copy_path_analysis
WHERE analysis_type IN ('first_portfolio', 'last_portfolio');

-- Delete old creator analysis types
DELETE FROM creator_copy_path_analysis
WHERE analysis_type IN ('first_creator', 'last_creator');

-- Log cleanup
DO $$
DECLARE
  portfolio_deleted INT;
  creator_deleted INT;
BEGIN
  GET DIAGNOSTICS portfolio_deleted = ROW_COUNT;

  SELECT COUNT(*) INTO creator_deleted
  FROM creator_copy_path_analysis
  WHERE analysis_type IN ('first_creator', 'last_creator');

  RAISE NOTICE '';
  RAISE NOTICE '✅ Cleaned up old copy path analysis types';
  RAISE NOTICE '   - Removed % rows from portfolio_copy_path_analysis', portfolio_deleted;
  RAISE NOTICE '   - Removed % rows from creator_copy_path_analysis', creator_deleted;
  RAISE NOTICE '   - Old types: first_portfolio, last_portfolio, first_creator, last_creator';
  RAISE NOTICE '   - New types: top_portfolios_viewed, top_creators_viewed';
  RAISE NOTICE '   - Run analyze-portfolio-sequences and analyze-creator-sequences to populate new data';
  RAISE NOTICE '';
END $$;
