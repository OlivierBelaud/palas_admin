-- Rollback for: add email_marketing_opt_out_at on contacts.
DROP INDEX IF EXISTS "contacts_email_marketing_opt_out_at_idx";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "email_marketing_opt_out_at";
