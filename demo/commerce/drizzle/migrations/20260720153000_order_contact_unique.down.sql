-- Rollback removes only the replay guard. Financial and identity projection
-- rows, including all order/contact history, are preserved.
DROP INDEX IF EXISTS order_contact_active_order_contact_key;
