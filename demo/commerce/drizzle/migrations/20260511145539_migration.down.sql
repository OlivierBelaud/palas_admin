-- Rollback: drop the cart_order pivot table introduced by the
-- corresponding forward migration.

DROP INDEX IF EXISTS "idx_cart_order_order_id";
DROP INDEX IF EXISTS "idx_cart_order_cart_id";
DROP TABLE IF EXISTS "cart_order";
