DROP INDEX IF EXISTS "abandoned_cart_messages_case_sequence_type_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "abandoned_cart_messages_case_type_unique"
  ON "abandoned_cart_messages" ("case_id", "message_type");

DROP INDEX IF EXISTS "abandoned_cart_messages_sequence_started_at_idx";
DROP INDEX IF EXISTS "abandoned_cart_messages_sequence_version_idx";
ALTER TABLE "abandoned_cart_messages"
  DROP COLUMN IF EXISTS "sequence_started_at",
  DROP COLUMN IF EXISTS "sequence_version";

DROP INDEX IF EXISTS "abandoned_cart_cases_sequence_started_at_idx";
DROP INDEX IF EXISTS "abandoned_cart_cases_current_sequence_version_idx";
ALTER TABLE "abandoned_cart_cases"
  DROP COLUMN IF EXISTS "sequence_started_at",
  DROP COLUMN IF EXISTS "current_sequence_version";
