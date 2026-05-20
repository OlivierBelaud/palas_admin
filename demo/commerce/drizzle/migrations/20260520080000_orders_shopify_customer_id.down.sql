DROP INDEX IF EXISTS orders_shopify_customer_id_idx;
ALTER TABLE orders DROP COLUMN IF EXISTS shopify_customer_id;
