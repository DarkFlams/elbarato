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
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price_x3 NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price_x6 NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price_x12 NUMERIC(10,2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price_tier TEXT DEFAULT 'normal';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_expense_eligible BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE partners
SET
  display_name = 'Medias',
  is_expense_eligible = FALSE
WHERE name = 'todos';

UPDATE products SET purchase_price = 0 WHERE purchase_price < 0;
UPDATE products SET sale_price = 0.01 WHERE sale_price <= 0;
UPDATE products SET sale_price_x3 = NULL WHERE sale_price_x3 < 0;
UPDATE products SET sale_price_x6 = NULL WHERE sale_price_x6 < 0;
UPDATE products SET sale_price_x12 = NULL WHERE sale_price_x12 < 0;
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
SET price_tier = 'normal'
WHERE price_tier IS NULL
   OR price_tier NOT IN ('normal', 'x3', 'x6', 'x12', 'manual');

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

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sale_price_x3_nonnegative') THEN
    ALTER TABLE products
    ADD CONSTRAINT products_sale_price_x3_nonnegative CHECK (sale_price_x3 IS NULL OR sale_price_x3 >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sale_price_x6_nonnegative') THEN
    ALTER TABLE products
    ADD CONSTRAINT products_sale_price_x6_nonnegative CHECK (sale_price_x6 IS NULL OR sale_price_x6 >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sale_price_x12_nonnegative') THEN
    ALTER TABLE products
    ADD CONSTRAINT products_sale_price_x12_nonnegative CHECK (sale_price_x12 IS NULL OR sale_price_x12 >= 0);
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

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_price_tier_valid') THEN
    ALTER TABLE sale_items
    ADD CONSTRAINT sale_items_price_tier_valid CHECK (price_tier IN ('normal', 'x3', 'x6', 'x12', 'manual'));
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

-- ============================================
-- Stock movil QR: base de datos y auditoria
-- ============================================
ALTER TABLE products
ADD COLUMN IF NOT EXISTS stock_revision BIGINT NOT NULL DEFAULT 1;

UPDATE products
SET stock_revision = 1
WHERE stock_revision IS NULL
   OR stock_revision < 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_stock_revision_positive'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_stock_revision_positive CHECK (stock_revision > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_stock_revision
ON products(stock_revision);

CREATE TABLE IF NOT EXISTS mobile_access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  qr_token TEXT UNIQUE NOT NULL,
  issued_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_access_codes_expires_at
ON mobile_access_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_mobile_access_codes_revoked_at
ON mobile_access_codes(revoked_at);

CREATE TABLE IF NOT EXISTS mobile_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES mobile_access_codes(id) ON DELETE CASCADE,
  operator_name TEXT,
  scope TEXT NOT NULL DEFAULT 'stock_only',
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mobile_sessions_scope_check'
  ) THEN
    ALTER TABLE mobile_sessions
    ADD CONSTRAINT mobile_sessions_scope_check CHECK (scope IN ('stock_only'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mobile_sessions_expires_at
ON mobile_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_mobile_sessions_revoked_at
ON mobile_sessions(revoked_at);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  performed_by_session_id UUID REFERENCES mobile_sessions(id),
  source TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'physical_count',
  stock_before INT NOT NULL,
  stock_counted INT NOT NULL,
  delta INT NOT NULL,
  stock_revision_before BIGINT NOT NULL,
  stock_revision_after BIGINT NOT NULL,
  is_flagged BOOLEAN NOT NULL DEFAULT false,
  flag_reason TEXT,
  review_status TEXT NOT NULL DEFAULT 'auto_applied',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_adjustments_source_check'
  ) THEN
    ALTER TABLE stock_adjustments
    ADD CONSTRAINT stock_adjustments_source_check
    CHECK (source IN ('mobile_count', 'desktop_manual', 'audit_round'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_adjustments_review_status_check'
  ) THEN
    ALTER TABLE stock_adjustments
    ADD CONSTRAINT stock_adjustments_review_status_check
    CHECK (review_status IN ('auto_applied', 'reviewed_ok', 'reverted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product_id
ON stock_adjustments(product_id);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_created_at
ON stock_adjustments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_review_status
ON stock_adjustments(review_status);

CREATE TABLE IF NOT EXISTS stock_audit_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id),
  started_by_session_id UUID NOT NULL REFERENCES mobile_sessions(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_audit_rounds_status_check'
  ) THEN
    ALTER TABLE stock_audit_rounds
    ADD CONSTRAINT stock_audit_rounds_status_check
    CHECK (status IN ('open', 'closed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_audit_rounds_partner_id
ON stock_audit_rounds(partner_id);

CREATE INDEX IF NOT EXISTS idx_stock_audit_rounds_status
ON stock_audit_rounds(status);

CREATE TABLE IF NOT EXISTS stock_audit_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES stock_audit_rounds(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_audit_scans_round_id
ON stock_audit_scans(round_id);

CREATE INDEX IF NOT EXISTS idx_stock_audit_scans_product_id
ON stock_audit_scans(product_id);

ALTER TABLE mobile_access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_audit_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_audit_scans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mobile_access_codes'
      AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY "auth_all"
    ON mobile_access_codes
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mobile_sessions'
      AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY "auth_all"
    ON mobile_sessions
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stock_adjustments'
      AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY "auth_all"
    ON stock_adjustments
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stock_audit_rounds'
      AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY "auth_all"
    ON stock_audit_rounds
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stock_audit_scans'
      AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY "auth_all"
    ON stock_audit_scans
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

COMMIT;
