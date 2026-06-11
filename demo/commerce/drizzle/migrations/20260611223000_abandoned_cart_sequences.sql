ALTER TABLE "abandoned_cart_cases"
  ADD COLUMN IF NOT EXISTS "current_sequence_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "sequence_started_at" TIMESTAMPTZ;

UPDATE "abandoned_cart_cases"
SET "sequence_started_at" = COALESCE("sequence_started_at", "last_cart_action_at", "opened_at")
WHERE "sequence_started_at" IS NULL;

CREATE INDEX IF NOT EXISTS "abandoned_cart_cases_current_sequence_version_idx"
  ON "abandoned_cart_cases" ("current_sequence_version");
CREATE INDEX IF NOT EXISTS "abandoned_cart_cases_sequence_started_at_idx"
  ON "abandoned_cart_cases" ("sequence_started_at");

ALTER TABLE "abandoned_cart_messages"
  ADD COLUMN IF NOT EXISTS "sequence_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "sequence_started_at" TIMESTAMPTZ;

UPDATE "abandoned_cart_messages" m
SET "sequence_started_at" = COALESCE(m."sequence_started_at", acc."sequence_started_at", acc."last_cart_action_at", acc."opened_at")
FROM "abandoned_cart_cases" acc
WHERE m."case_id" = acc."id"
  AND m."sequence_started_at" IS NULL;

CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_sequence_version_idx"
  ON "abandoned_cart_messages" ("sequence_version");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_sequence_started_at_idx"
  ON "abandoned_cart_messages" ("sequence_started_at");

DROP INDEX IF EXISTS "abandoned_cart_messages_case_type_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "abandoned_cart_messages_case_sequence_type_unique"
  ON "abandoned_cart_messages" ("case_id", "sequence_version", "message_type");
