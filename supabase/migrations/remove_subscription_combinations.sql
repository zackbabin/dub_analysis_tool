-- Remove subscription combination rows (subscription analysis uses correlation/regression, not combinations)
-- Only 'copy' (portfolio combinations) and 'creator_copy' (creator combinations) should exist

DELETE FROM conversion_pattern_combinations
WHERE analysis_type = 'subscription';

-- Verify remaining analysis types
SELECT
    analysis_type,
    COUNT(*) as row_count,
    MIN(rank) as min_rank,
    MAX(rank) as max_rank
FROM conversion_pattern_combinations
GROUP BY analysis_type
ORDER BY analysis_type;
