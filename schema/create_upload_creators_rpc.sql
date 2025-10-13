-- Create RPC function to bypass PostgREST schema cache
-- This function inserts directly into uploaded_creators using raw SQL

CREATE OR REPLACE FUNCTION insert_uploaded_creators(
  creators_data jsonb[]
)
RETURNS TABLE (
  inserted_count integer,
  success boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  creator_record jsonb;
  inserted_rows integer := 0;
BEGIN
  -- Loop through each creator and insert
  FOREACH creator_record IN ARRAY creators_data
  LOOP
    INSERT INTO uploaded_creators (
      creator_username,
      email,
      raw_data,
      uploaded_at
    ) VALUES (
      creator_record->>'creator_username',
      creator_record->>'email',
      creator_record->'raw_data',
      (creator_record->>'uploaded_at')::timestamp with time zone
    );

    inserted_rows := inserted_rows + 1;
  END LOOP;

  RETURN QUERY SELECT inserted_rows, true;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION insert_uploaded_creators(jsonb[]) TO authenticated;
GRANT EXECUTE ON FUNCTION insert_uploaded_creators(jsonb[]) TO service_role;
