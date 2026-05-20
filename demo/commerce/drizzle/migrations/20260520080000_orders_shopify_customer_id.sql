ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_customer_id text;
CREATE INDEX IF NOT EXISTS orders_shopify_customer_id_idx ON orders (shopify_customer_id);
