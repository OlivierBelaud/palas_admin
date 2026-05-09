-- Add source attribution for abandonment-flow notifications.
-- Set when Manta sends a Resend email ('manta') or when sync-klaviyo-events
-- ingests a Klaviyo abandonment event for the cart's email ('klaviyo').
-- Distinct from abandon_notified_at (the timestamp); together they form
-- a unified record of "who notified this cart, when".
ALTER TABLE "carts"
  ADD COLUMN IF NOT EXISTS "abandon_notified_source" TEXT;
