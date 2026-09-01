-- 003_stage2_operational_model.sql

-- Modify purchase_orders to separate items
ALTER TABLE purchase_orders DROP COLUMN product_id;
ALTER TABLE purchase_orders DROP COLUMN quantity;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (purchase_order_id, product_id)
);
