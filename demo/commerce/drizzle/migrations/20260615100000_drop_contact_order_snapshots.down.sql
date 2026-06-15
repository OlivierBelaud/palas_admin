ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "orders_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_spent" double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "first_order_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_order_at" timestamptz;
