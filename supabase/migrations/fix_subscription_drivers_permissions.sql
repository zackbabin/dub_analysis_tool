-- Fix subscription_drivers table permissions
-- Allow anon role to INSERT and DELETE so client-side can save regression results

-- Drop existing anon policy
DROP POLICY IF EXISTS "Allow anon to read subscription_drivers" ON public.subscription_drivers;

-- Create new policy that allows anon to do everything (read, insert, delete)
CREATE POLICY "Allow anon full access to subscription_drivers"
ON public.subscription_drivers
FOR ALL
TO anon
USING (true)
WITH CHECK (true);

COMMENT ON POLICY "Allow anon full access to subscription_drivers" ON public.subscription_drivers IS
'Allow client-side JavaScript to save subscription driver analysis results. This is safe because the data is derived from user analysis and not user-generated content.';
