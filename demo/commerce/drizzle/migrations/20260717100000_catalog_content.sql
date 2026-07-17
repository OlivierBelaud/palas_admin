CREATE TABLE IF NOT EXISTS catalog_homepage_tiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_collection_id text NOT NULL,
  label_fr text,
  label_en text,
  image_source text NOT NULL DEFAULT 'collection'
    CHECK (image_source IN ('collection', 'product')),
  shopify_product_id text,
  image_url text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_homepage_tiles_position_idx
  ON catalog_homepage_tiles (position);

CREATE TABLE IF NOT EXISTS catalog_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES catalog_menu_items(id) ON DELETE RESTRICT,
  shopify_collection_id text,
  label_fr text NOT NULL,
  label_en text,
  url text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_menu_items_parent_position_idx
  ON catalog_menu_items (parent_id, position);
