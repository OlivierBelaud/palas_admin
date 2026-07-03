DELETE FROM "marketing_rules"
WHERE "payload"->>'source' = 'palas_seed'
  AND "payload"->>'gift_rule' IN ('auto_charm_first_item', 'auto_charm_threshold_150');
