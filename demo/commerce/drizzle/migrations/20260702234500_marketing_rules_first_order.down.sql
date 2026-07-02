ALTER TABLE "marketing_rules" DROP CONSTRAINT IF EXISTS "marketing_rules_rule_type_check";

ALTER TABLE "marketing_rules"
  ADD CONSTRAINT "marketing_rules_rule_type_check"
  CHECK ("rule_type" IN ('order_discount', 'gift_threshold', 'shipping_threshold'));
