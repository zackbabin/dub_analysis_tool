-- Add total_copies column to conversion_pattern_combinations table
-- This tracks the total number of copies made by users exposed to both entities in a combination

ALTER TABLE conversion_pattern_combinations
ADD COLUMN IF NOT EXISTS total_copies INTEGER;

-- Add comment explaining the column
COMMENT ON COLUMN conversion_pattern_combinations.total_copies IS
  'Total number of copies made by users who viewed BOTH entities in this combination.
   For portfolio combinations: sum of all portfolio copies by the cohort.
   For creator combinations: sum of all portfolio copies from that creator by the cohort.';

-- Add index for faster queries on total_copies
CREATE INDEX IF NOT EXISTS idx_pattern_combinations_total_copies
  ON conversion_pattern_combinations(total_copies)
  WHERE total_copies > 0;
