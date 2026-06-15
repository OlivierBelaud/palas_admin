ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_country_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_country_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_city text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_province_code text;

CREATE INDEX IF NOT EXISTS orders_shipping_country_code_idx ON orders (shipping_country_code);
