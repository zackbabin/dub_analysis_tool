-- Create storage bucket for Mixpanel data
-- Used by sync-mixpanel-user-properties-v2 to store raw API responses

-- Create the bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('mixpanel-data', 'mixpanel-data', false)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for the bucket
-- Allow service_role full access
-- Drop policies if they exist first
DROP POLICY IF EXISTS "Service role can upload to mixpanel-data" ON storage.objects;
DROP POLICY IF EXISTS "Service role can read from mixpanel-data" ON storage.objects;
DROP POLICY IF EXISTS "Service role can update mixpanel-data" ON storage.objects;
DROP POLICY IF EXISTS "Service role can delete from mixpanel-data" ON storage.objects;

-- Create policies
CREATE POLICY "Service role can upload to mixpanel-data"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'mixpanel-data');

CREATE POLICY "Service role can read from mixpanel-data"
ON storage.objects
FOR SELECT
TO service_role
USING (bucket_id = 'mixpanel-data');

CREATE POLICY "Service role can update mixpanel-data"
ON storage.objects
FOR UPDATE
TO service_role
USING (bucket_id = 'mixpanel-data');

CREATE POLICY "Service role can delete from mixpanel-data"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = 'mixpanel-data');

-- Add comment
COMMENT ON TABLE storage.buckets IS 'Storage bucket for Mixpanel API responses. Used by sync-mixpanel-user-properties-v2 to store raw data before processing.';
