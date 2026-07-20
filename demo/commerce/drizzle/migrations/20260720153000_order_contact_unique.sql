-- Make Shopify order/contact projection replays concurrency-safe.
-- Existing duplicate active pivots are collapsed without deleting either
-- the order or contact projection. Soft-deleted history remains untouched.
LOCK TABLE order_contact IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM order_contact duplicate
USING order_contact keeper
WHERE duplicate.deleted_at IS NULL
  AND keeper.deleted_at IS NULL
  AND duplicate.ctid < keeper.ctid
  AND duplicate.order_id = keeper.order_id
  AND duplicate.contact_id = keeper.contact_id;

CREATE UNIQUE INDEX IF NOT EXISTS order_contact_active_order_contact_key
  ON order_contact (order_id, contact_id)
  WHERE deleted_at IS NULL;
