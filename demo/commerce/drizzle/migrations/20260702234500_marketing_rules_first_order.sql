DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'marketing_rules'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%rule_type%'
    AND pg_get_constraintdef(oid) LIKE '%order_discount%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "marketing_rules" DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE "marketing_rules"
  ADD CONSTRAINT "marketing_rules_rule_type_check"
  CHECK ("rule_type" IN ('order_discount', 'first_order_discount', 'gift_threshold', 'shipping_threshold'));
