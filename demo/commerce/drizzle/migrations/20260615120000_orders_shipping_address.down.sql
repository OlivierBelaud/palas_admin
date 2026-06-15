DROP INDEX IF EXISTS orders_shipping_country_code_idx;
ALTER TABLE orders DROP COLUMN IF EXISTS shipping_province_code;
ALTER TABLE orders DROP COLUMN IF EXISTS shipping_city;
ALTER TABLE orders DROP COLUMN IF EXISTS shipping_country_name;
ALTER TABLE orders DROP COLUMN IF EXISTS shipping_country_code;
