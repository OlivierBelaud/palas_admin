-- Reporting delivery audit evidence is intentionally retained on rollback.
-- Only optional access-path indexes may be removed safely.
DROP INDEX IF EXISTS "visitor_sessions_reporting_email_message_idx";
DROP INDEX IF EXISTS "orders_reporting_eligible_placed_at_idx";
DROP INDEX IF EXISTS "reporting_daily_deliveries_claim_expiry_idx";
