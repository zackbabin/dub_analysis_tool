-- Add conversion rate columns to business_assumptions table

ALTER TABLE business_assumptions
ADD COLUMN IF NOT EXISTS kyc_to_linked_bank DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS linked_bank_to_ach DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS ach_to_copy DECIMAL(5,2);

-- Add comments to explain the columns
COMMENT ON COLUMN business_assumptions.kyc_to_linked_bank IS 'Conversion rate from Approved KYC to Linked Bank Account (percentage)';
COMMENT ON COLUMN business_assumptions.linked_bank_to_ach IS 'Conversion rate from Linked Bank Account to Initiated ACH Transfer (percentage)';
COMMENT ON COLUMN business_assumptions.ach_to_copy IS 'Conversion rate from Initiated ACH Transfer to Copied Portfolio (percentage)';
