CREATE TABLE IF NOT EXISTS catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title_fr text NOT NULL,
  title_en text,
  parent_id uuid REFERENCES catalog_categories(id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS catalog_categories_parent_position_idx
  ON catalog_categories (parent_id, position)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS catalog_products (
  shopify_product_id text PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  title text NOT NULL,
  product_type text,
  image_url text,
  online_store_published boolean NOT NULL DEFAULT true,
  canonical_category_id uuid REFERENCES catalog_categories(id) ON DELETE SET NULL,
  category_position integer NOT NULL DEFAULT 0,
  visual_group text,
  visual_subtype text,
  shopify_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_products_category_position_idx
  ON catalog_products (canonical_category_id, category_position, title);

CREATE INDEX IF NOT EXISTS catalog_products_unclassified_idx
  ON catalog_products (title)
  WHERE canonical_category_id IS NULL;

INSERT INTO catalog_categories (slug, title_fr, title_en, parent_id, position, status)
VALUES ('jewellery', 'Bijoux', 'Jewellery', NULL, 0, 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO catalog_categories (slug, title_fr, title_en, parent_id, position, status)
SELECT seed.slug, seed.title_fr, seed.title_en, parent.id, seed.position, 'active'
FROM (VALUES
  ('charms', 'Breloques', 'Charms', 'jewellery', 0),
  ('necklaces', 'Colliers', 'Necklaces', 'jewellery', 1),
  ('chokers', 'Ras-de-cou', 'Chokers', 'jewellery', 2),
  ('bracelets', 'Bracelets', 'Bracelets', 'jewellery', 3),
  ('anklets', 'Bracelets de cheville', 'Anklets', 'jewellery', 4),
  ('earrings', 'Boucles d’oreilles', 'Earrings', 'jewellery', 5),
  ('rings', 'Bagues', 'Rings', 'jewellery', 6),
  ('sets', 'Sets de bijoux', 'Jewellery sets', 'jewellery', 7),
  ('non-jewellery', 'Hors bijoux', 'Non-jewellery', 'jewellery', 8)
) AS seed(slug, title_fr, title_en, parent_slug, position)
JOIN catalog_categories parent ON parent.slug = seed.parent_slug
ON CONFLICT (slug) DO NOTHING;

INSERT INTO catalog_categories (slug, title_fr, title_en, parent_id, position, status)
SELECT seed.slug, seed.title_fr, seed.title_en, parent.id, seed.position, 'active'
FROM (VALUES
  ('charms-medals', 'Médailles', 'Medal charms', 'charms', 0),
  ('charms-figurative', 'Breloques figuratives', 'Figurative charms', 'charms', 1),
  ('charms-chain-extension', 'Extensions de chaîne', 'Chain extensions', 'charms', 2),
  ('necklaces-medallion-chain', 'Médaillons sur chaîne', 'Medallions on chains', 'necklaces', 0),
  ('necklaces-medallion-pendant', 'Pendentifs médaillon', 'Medallion pendants', 'necklaces', 1),
  ('necklaces-chain', 'Colliers chaîne', 'Chain necklaces', 'necklaces', 2),
  ('necklaces-beaded', 'Colliers en perles', 'Beaded necklaces', 'necklaces', 3),
  ('necklaces-pendant', 'Colliers pendentif', 'Pendant necklaces', 'necklaces', 4),
  ('necklaces-charms', 'Colliers à breloques', 'Charm necklaces', 'necklaces', 5),
  ('long-necklaces-chain', 'Sautoirs chaîne', 'Long chain necklaces', 'necklaces', 6),
  ('long-necklaces-pendant', 'Sautoirs pendentif', 'Long pendant necklaces', 'necklaces', 7),
  ('chokers-beaded', 'Ras-de-cou en perles', 'Beaded chokers', 'chokers', 0),
  ('chokers-beaded-charms', 'Ras-de-cou perles et breloques', 'Beaded charm chokers', 'chokers', 1),
  ('chokers-chain', 'Ras-de-cou chaîne', 'Chain chokers', 'chokers', 2),
  ('chokers-chain-charms', 'Ras-de-cou chaîne et breloques', 'Chain charm chokers', 'chokers', 3),
  ('chokers-pendant', 'Ras-de-cou pendentif', 'Pendant chokers', 'chokers', 4),
  ('bracelets-beaded', 'Bracelets en perles', 'Beaded bracelets', 'bracelets', 0),
  ('bracelets-chain', 'Bracelets chaîne', 'Chain bracelets', 'bracelets', 1),
  ('bracelets-charms', 'Bracelets à breloques', 'Charm bracelets', 'bracelets', 2),
  ('anklets-beaded', 'Chevillères en perles', 'Beaded anklets', 'anklets', 0),
  ('anklets-chain', 'Chevillères chaîne', 'Chain anklets', 'anklets', 1),
  ('anklets-charms', 'Chevillères à breloques', 'Charm anklets', 'anklets', 2),
  ('earrings-hoops', 'Créoles', 'Hoop earrings', 'earrings', 0),
  ('earrings-drop', 'Boucles pendantes', 'Drop earrings', 'earrings', 1),
  ('earrings-stud', 'Puces', 'Stud earrings', 'earrings', 2),
  ('rings-statement', 'Bagues statement', 'Statement rings', 'rings', 0),
  ('sets-bracelet-charms', 'Bracelet et breloques', 'Bracelet and charm sets', 'sets', 0),
  ('sets-neckwear-charms', 'Collier et breloques', 'Neckwear and charm sets', 'sets', 1),
  ('sets-loose-charms', 'Sets de breloques', 'Loose charm sets', 'sets', 2),
  ('non-jewellery-gift-cards', 'Cartes cadeaux', 'Gift cards', 'non-jewellery', 0),
  ('non-jewellery-bags', 'Sacs', 'Bags', 'non-jewellery', 1),
  ('non-jewellery-editorial', 'Visuels éditoriaux', 'Editorial visuals', 'non-jewellery', 2)
) AS seed(slug, title_fr, title_en, parent_slug, position)
JOIN catalog_categories parent ON parent.slug = seed.parent_slug
ON CONFLICT (slug) DO NOTHING;
