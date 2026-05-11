-- Dedup duplicate cart_order pivot rows then enforce uniqueness on (cart_id, order_id).
-- The pivot is populated by upsertShopifyOrder; without UNIQUE the ON CONFLICT
-- DO NOTHING can't match, so every replay adds another row.

DELETE FROM cart_order a
 USING cart_order b
 WHERE a.cart_id = b.cart_id
   AND a.order_id = b.order_id
   AND a.created_at > b.created_at;

ALTER TABLE cart_order
  ADD CONSTRAINT cart_order_cart_id_order_id_key UNIQUE (cart_id, order_id);
