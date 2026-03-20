-- ============================================
-- Existing DB Patch (Idempotent)
-- ============================================
-- Use this on databases where schema.sql was already executed.
-- It applies only incremental changes safely.

BEGIN;

-- Ensure enum exists and contains expected values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'inventory_movement_reason'
  ) THEN
    CREATE TYPE inventory_movement_reason AS ENUM (
      'sale',
      'manual_adjustment',
      'initial_stock',
      'restock',
      'return'
    );
  ELSE
    ALTER TYPE inventory_movement_reason ADD VALUE IF NOT EXISTS 'sale';
    ALTER TYPE inventory_movement_reason ADD VALUE IF NOT EXISTS 'manual_adjustment';
    ALTER TYPE inventory_movement_reason ADD VALUE IF NOT EXISTS 'initial_stock';
    ALTER TYPE inventory_movement_reason ADD VALUE IF NOT EXISTS 'restock';
    ALTER TYPE inventory_movement_reason ADD VALUE IF NOT EXISTS 'return';
  END IF;
END $$;

-- Ensure inventory movement reasons are valid before casting to enum
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_movements'
      AND column_name = 'reason'
  ) THEN
    UPDATE inventory_movements
    SET reason = 'manual_adjustment'
    WHERE reason::text NOT IN (
      'sale',
      'manual_adjustment',
      'initial_stock',
      'restock',
      'return'
    );

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'inventory_movements'
        AND column_name = 'reason'
        AND udt_name <> 'inventory_movement_reason'
    ) THEN
      ALTER TABLE inventory_movements
      ALTER COLUMN reason
      TYPE inventory_movement_reason
      USING reason::inventory_movement_reason;
    END IF;
  END IF;
END $$;

-- Data cleanup before applying constraints
ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_received NUMERIC(10,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_given NUMERIC(10,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_expense_eligible BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE partners
SET
  display_name = 'Medias',
  is_expense_eligible = FALSE
WHERE name = 'todos';

UPDATE products SET purchase_price = 0 WHERE purchase_price < 0;
UPDATE products SET sale_price = 0.01 WHERE sale_price <= 0;
UPDATE products SET stock = 0 WHERE stock < 0;
UPDATE products SET min_stock = 0 WHERE min_stock < 0;

UPDATE cash_sessions SET opening_cash = 0 WHERE opening_cash < 0;
UPDATE cash_sessions SET closing_cash = 0 WHERE closing_cash < 0;

UPDATE sales SET total = 0 WHERE total < 0;
UPDATE sales
SET payment_method = 'cash'
WHERE payment_method IS NULL
   OR payment_method NOT IN ('cash', 'transfer');

UPDATE sale_items
SET quantity = 1
WHERE quantity <= 0;

UPDATE sale_items
SET unit_price = 0
WHERE unit_price < 0;

UPDATE sale_items
SET subtotal = ROUND(quantity * unit_price, 2)
WHERE subtotal < 0
   OR subtotal <> ROUND(quantity * unit_price, 2);

UPDATE expenses
SET amount = 0.01
WHERE amount <= 0;

UPDATE expense_allocations
SET amount = 0
WHERE amount < 0;

DELETE FROM inventory_movements
WHERE quantity_change = 0;

-- Add constraints if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_purchase_price_nonnegative') THEN
    ALTER TABLE products
    ADD CONSTRAINT products_purchase_price_nonnegative CHECK (purchase_price >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sale_price_positive') THEN
    ALTER TABLE products
    ADD CONSTRAINT products_sale_price_positive CHECK (sale_price > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_nonnegative') THEN
    ALTER TABLE products
    ADD CONSTRAINT products_stock_nonnegative CHECK (stock >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_min_stock_nonnegative') THEN
    ALTER TABLE products
    ADD CONSTRAINT products_min_stock_nonnegative CHECK (min_stock >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_sessions_opening_cash_nonnegative') THEN
    ALTER TABLE cash_sessions
    ADD CONSTRAINT cash_sessions_opening_cash_nonnegative CHECK (opening_cash >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_sessions_closing_cash_nonnegative') THEN
    ALTER TABLE cash_sessions
    ADD CONSTRAINT cash_sessions_closing_cash_nonnegative CHECK (closing_cash IS NULL OR closing_cash >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_total_nonnegative') THEN
    ALTER TABLE sales
    ADD CONSTRAINT sales_total_nonnegative CHECK (total >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_payment_method_valid') THEN
    ALTER TABLE sales
    ADD CONSTRAINT sales_payment_method_valid CHECK (payment_method IN ('cash', 'transfer'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_amount_received_nonnegative') THEN
    ALTER TABLE sales
    ADD CONSTRAINT sales_amount_received_nonnegative CHECK (amount_received IS NULL OR amount_received >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_change_given_nonnegative') THEN
    ALTER TABLE sales
    ADD CONSTRAINT sales_change_given_nonnegative CHECK (change_given IS NULL OR change_given >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_quantity_positive') THEN
    ALTER TABLE sale_items
    ADD CONSTRAINT sale_items_quantity_positive CHECK (quantity > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_unit_price_nonnegative') THEN
    ALTER TABLE sale_items
    ADD CONSTRAINT sale_items_unit_price_nonnegative CHECK (unit_price >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_subtotal_nonnegative') THEN
    ALTER TABLE sale_items
    ADD CONSTRAINT sale_items_subtotal_nonnegative CHECK (subtotal >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_amount_positive') THEN
    ALTER TABLE expenses
    ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expense_allocations_amount_nonnegative') THEN
    ALTER TABLE expense_allocations
    ADD CONSTRAINT expense_allocations_amount_nonnegative CHECK (amount >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movements_quantity_nonzero') THEN
    ALTER TABLE inventory_movements
    ADD CONSTRAINT inventory_movements_quantity_nonzero CHECK (quantity_change <> 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency_key
ON sales(idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_idempotency_key
ON expenses(idempotency_key)
WHERE idempotency_key IS NOT NULL;

COMMIT;
