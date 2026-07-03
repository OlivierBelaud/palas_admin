INSERT INTO "marketing_rules" (
  "title",
  "rule_type",
  "status",
  "starts_at",
  "execution_kind",
  "sync_status",
  "value_type",
  "value",
  "payload"
)
SELECT
  'Offre de bienvenue -10%',
  'first_order_discount',
  'active',
  '2020-01-01T00:00:00Z'::timestamptz,
  'local_cart_rule',
  'local_only',
  'percentage',
  10,
  '{"personal_offer":"welcome"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM "marketing_rules"
  WHERE "deleted_at" IS NULL
    AND "payload"->>'personal_offer' = 'welcome'
);

INSERT INTO "marketing_rules" (
  "title",
  "rule_type",
  "status",
  "starts_at",
  "execution_kind",
  "sync_status",
  "value_type",
  "value",
  "payload"
)
SELECT
  'Panier abandonné -10%',
  'order_discount',
  'active',
  '2020-01-01T00:00:00Z'::timestamptz,
  'local_cart_rule',
  'local_only',
  'percentage',
  10,
  '{"personal_offer":"abandoned_cart"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM "marketing_rules"
  WHERE "deleted_at" IS NULL
    AND "payload"->>'personal_offer' = 'abandoned_cart'
);

INSERT INTO "marketing_rules" (
  "title",
  "rule_type",
  "status",
  "starts_at",
  "execution_kind",
  "sync_status",
  "value_type",
  "value",
  "payload"
)
SELECT
  'Anniversaire -15%',
  'order_discount',
  'active',
  '2020-01-01T00:00:00Z'::timestamptz,
  'local_cart_rule',
  'local_only',
  'percentage',
  15,
  '{"personal_offer":"birthday"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM "marketing_rules"
  WHERE "deleted_at" IS NULL
    AND "payload"->>'personal_offer' = 'birthday'
);
