DROP INDEX IF EXISTS "abandoned_cart_messages_snapshot_saved_at_idx";
DROP INDEX IF EXISTS "abandoned_cart_messages_snapshot_sha256_idx";

ALTER TABLE "abandoned_cart_messages"
  DROP COLUMN IF EXISTS "snapshot_error",
  DROP COLUMN IF EXISTS "snapshot_saved_at",
  DROP COLUMN IF EXISTS "snapshot_sha256",
  DROP COLUMN IF EXISTS "snapshot_subject",
  DROP COLUMN IF EXISTS "snapshot_text_url",
  DROP COLUMN IF EXISTS "snapshot_text_key",
  DROP COLUMN IF EXISTS "snapshot_html_url",
  DROP COLUMN IF EXISTS "snapshot_html_key";
