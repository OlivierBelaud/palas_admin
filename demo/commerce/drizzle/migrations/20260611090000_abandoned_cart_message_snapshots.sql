ALTER TABLE "abandoned_cart_messages"
  ADD COLUMN IF NOT EXISTS "snapshot_html_key" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_html_url" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_text_key" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_text_url" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_subject" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_sha256" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_saved_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "snapshot_error" TEXT;

CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_snapshot_sha256_idx"
  ON "abandoned_cart_messages" ("snapshot_sha256");

CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_snapshot_saved_at_idx"
  ON "abandoned_cart_messages" ("snapshot_saved_at");
