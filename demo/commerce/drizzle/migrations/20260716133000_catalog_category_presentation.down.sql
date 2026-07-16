DROP INDEX IF EXISTS catalog_categories_representative_product_idx;
ALTER TABLE catalog_categories DROP COLUMN IF EXISTS representative_product_id;
