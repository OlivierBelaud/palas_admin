CREATE TABLE IF NOT EXISTS catalog_shopify_mirrors (
  sync_key text PRIMARY KEY,
  category_id uuid UNIQUE REFERENCES catalog_categories(id) ON DELETE SET NULL,
  shopify_collection_id text UNIQUE,
  handle text NOT NULL UNIQUE,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_shopify_mirrors_category_idx
  ON catalog_shopify_mirrors (category_id)
  WHERE category_id IS NOT NULL;
