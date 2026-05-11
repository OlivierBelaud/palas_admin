-- Add the cart -> order pivot table behind `defineLink('cart', 'order')`.
-- Mirrors the schema produced by the framework's `generateLinkPgTable`
-- for a 1:1 link. The pivot lets us join a cart row to its Shopify
-- order mirror without going through email or shopify_order_id.
--
-- Indexes follow the existing `idx_<table>_<fk>` convention used by
-- bootstrap-crm.ts for the cart_contact and order_contact pivots.

CREATE TABLE IF NOT EXISTS "cart_order" (
  "id" TEXT PRIMARY KEY,
  "cart_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "idx_cart_order_cart_id" ON "cart_order" ("cart_id");
CREATE INDEX IF NOT EXISTS "idx_cart_order_order_id" ON "cart_order" ("order_id");
