WITH seed_rules AS (
  SELECT *
  FROM (
    VALUES
      ('fr', 'France', 'EUR', 'Charm offert des le premier produit - France', 0::double precision, 'gid://shopify/ProductVariant/50919730184539', 'Alma - Charm', 'auto_charm_first_item'),
      ('europe', 'Europe', 'EUR', 'Charm offert des le premier produit - Europe', 0::double precision, 'gid://shopify/ProductVariant/50919730184539', 'Alma - Charm', 'auto_charm_first_item'),
      ('still-euro-but-far', 'Still Euro But Far', 'EUR', 'Charm offert des le premier produit - Still Euro But Far', 0::double precision, 'gid://shopify/ProductVariant/50919730184539', 'Alma - Charm', 'auto_charm_first_item'),
      ('united-kingdom', 'United Kingdom', 'GBP', 'Charm offert des le premier produit - United Kingdom', 0::double precision, 'gid://shopify/ProductVariant/50919730184539', 'Alma - Charm', 'auto_charm_first_item'),
      ('row', 'International', 'USD', 'Charm offert des le premier produit - International', 0::double precision, 'gid://shopify/ProductVariant/50919730184539', 'Alma - Charm', 'auto_charm_first_item'),
      ('fr', 'France', 'EUR', 'Cadeau offert des 150 EUR - France', 150::double precision, 'gid://shopify/ProductVariant/50920205484379', 'Ameijoa - Charm', 'auto_charm_threshold_150'),
      ('europe', 'Europe', 'EUR', 'Cadeau offert des 150 EUR - Europe', 150::double precision, 'gid://shopify/ProductVariant/50920205484379', 'Ameijoa - Charm', 'auto_charm_threshold_150'),
      ('still-euro-but-far', 'Still Euro But Far', 'EUR', 'Cadeau offert des 150 EUR - Still Euro But Far', 150::double precision, 'gid://shopify/ProductVariant/50920205484379', 'Ameijoa - Charm', 'auto_charm_threshold_150'),
      ('united-kingdom', 'United Kingdom', 'GBP', 'Cadeau offert des 150 GBP - United Kingdom', 150::double precision, 'gid://shopify/ProductVariant/50920205484379', 'Ameijoa - Charm', 'auto_charm_threshold_150'),
      ('row', 'International', 'USD', 'Cadeau offert des 150 USD - International', 150::double precision, 'gid://shopify/ProductVariant/50920205484379', 'Ameijoa - Charm', 'auto_charm_threshold_150')
  ) AS rules(market_key, market_name, currency_code, title, threshold, gift_product_id, gift_title, gift_rule)
)
INSERT INTO "marketing_rules" (
  "title",
  "rule_type",
  "status",
  "starts_at",
  "execution_kind",
  "sync_status",
  "market_key",
  "currency_code",
  "threshold",
  "gift_product_id",
  "gift_title",
  "payload"
)
SELECT
  seed_rules.title,
  'gift_threshold',
  'active',
  '2026-07-03T00:00:00Z'::timestamptz,
  'local_cart_rule',
  'local_only',
  seed_rules.market_key,
  seed_rules.currency_code,
  seed_rules.threshold,
  seed_rules.gift_product_id,
  seed_rules.gift_title,
  jsonb_build_object(
    'source', 'palas_seed',
    'gift_rule', seed_rules.gift_rule,
    'market_name', seed_rules.market_name,
    'shopify_sync', false
  )
FROM seed_rules
WHERE NOT EXISTS (
  SELECT 1
  FROM "marketing_rules"
  WHERE "deleted_at" IS NULL
    AND "rule_type" = 'gift_threshold'
    AND "market_key" = seed_rules.market_key
    AND "payload"->>'gift_rule' = seed_rules.gift_rule
);
