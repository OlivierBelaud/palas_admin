DELETE FROM "marketing_rules"
WHERE "payload"->>'personal_offer' IN ('welcome', 'abandoned_cart', 'birthday')
  AND "shopify_id" IS NULL;
