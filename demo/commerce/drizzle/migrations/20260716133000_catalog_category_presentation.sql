ALTER TABLE catalog_categories
  ADD COLUMN IF NOT EXISTS representative_product_id text
  REFERENCES catalog_products(shopify_product_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS catalog_categories_representative_product_idx
  ON catalog_categories (representative_product_id)
  WHERE representative_product_id IS NOT NULL;
