-- Delivery facts are an operational audit trail. A rollback removes only the
-- lookup indexes; it deliberately retains the columns and their data so an
-- in-flight or ambiguous provider request remains reconcilable.
DROP INDEX IF EXISTS "abandoned_cart_messages_delivery_claimed_at_idx";
DROP INDEX IF EXISTS "abandoned_cart_messages_delivery_claim_token_idx";
DROP INDEX IF EXISTS "abandoned_cart_messages_provider_observed_at_idx";
DROP INDEX IF EXISTS "abandoned_cart_messages_provider_status_idx";
