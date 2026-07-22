-- Financial delivery evidence is intentionally retained on rollback.
-- Only optional access-path indexes may be removed safely.
DROP INDEX IF EXISTS "reporting_daily_deliveries_status_idx";
