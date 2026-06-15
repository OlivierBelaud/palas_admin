-- Remove duplicated order aggregate snapshots from contacts.
-- Order state is derived from `orders` and relation pivots at read time.

ALTER TABLE "contacts"
  DROP COLUMN IF EXISTS "orders_count",
  DROP COLUMN IF EXISTS "total_spent",
  DROP COLUMN IF EXISTS "first_order_at",
  DROP COLUMN IF EXISTS "last_order_at";
