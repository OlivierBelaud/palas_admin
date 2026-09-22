DROP INDEX IF EXISTS event_logs_unprepared_dispatch_idx;
ALTER TABLE event_logs DROP COLUMN IF EXISTS dispatch_prepared_at;
