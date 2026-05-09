-- Add Manta-internal marketing opt-out flag on Contact.
--
-- Distinct from klaviyo_subscribed/klaviyo_suppressed (which mirror Klaviyo
-- state). This column is set when a contact clicks the unsubscribe link in
-- one of OUR emails (Resend-sent, e.g. abandoned-cart relance) — it gates
-- whether we ever email them again from Manta-owned flows.
--
-- Nullable: NULL = no opt-out (free to email); a timestamp = opt-out date.
-- Indexed for the exclusion filter in the abandoned-cart selection query.

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "email_marketing_opt_out_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "contacts_email_marketing_opt_out_at_idx"
  ON "contacts" ("email_marketing_opt_out_at");
