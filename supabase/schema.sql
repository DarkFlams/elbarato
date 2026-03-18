-- ============================================
-- POS System Database Schema
-- Run this in Supabase SQL Editor
-- ============================================
-- IMPORTANT:
-- - Use this file for a NEW / EMPTY database.
-- - If your DB already has tables/types, run `supabase/schema_patch_existing.sql` instead.

-- ENUMS
CREATE TYPE partner_enum AS ENUM ('rosa', 'lorena', 'yadira', 'todos');
CREATE TYPE expense_scope AS ENUM ('individual', 'shared');
CREATE TYPE cash_session_status AS ENUM ('open', 'closed');
CREATE TYPE inventory_movement_reason AS ENUM (
  'sale',
  'manual_adjustment',
  'initial_stock',
  'restock',
  'return'
);

-- ============================================
-- SOCIAS
-- ============================================
CREATE TABLE partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name partner_enum UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed
INSERT INTO partners (name, display_name, color_hex) VALUES
  ('rosa', 'Rosa', '#F43F5E'),
  ('lorena', 'Lorena', '#22C55E'),
  ('yadira', 'Yadira', '#3B82F6'),
  ('todos', 'Todos', '#8B7A62');

-- ============================================
-- PRODUCTOS
-- ============================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT UNIQUE NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  owner_id UUID NOT NULL REFERENCES partners(id),
  purchase_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  min_stock INT NOT NULL DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT products_purchase_price_nonnegative CHECK (purchase_price >= 0),
  CONSTRAINT products_sale_price_positive CHECK (sale_price > 0),
  CONSTRAINT products_stock_nonnegative CHECK (stock >= 0),
  CONSTRAINT products_min_stock_nonnegative CHECK (min_stock >= 0)
);

CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_owner ON products(owner_id);
CREATE INDEX idx_products_sku ON products(sku);

-- ============================================
-- SESIONES DE CAJA
-- ============================================
CREATE TABLE cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by UUID REFERENCES auth.users(id),
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_cash NUMERIC(10,2) NOT NULL DEFAULT 0,
  closing_cash NUMERIC(10,2),
  status cash_session_status DEFAULT 'open',
  notes TEXT,
  CONSTRAINT cash_sessions_opening_cash_nonnegative CHECK (opening_cash >= 0),
  CONSTRAINT cash_sessions_closing_cash_nonnegative CHECK (closing_cash IS NULL OR closing_cash >= 0)
);

-- ============================================
-- VENTAS
-- ============================================
CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id UUID NOT NULL REFERENCES cash_sessions(id),
  sold_by UUID REFERENCES auth.users(id),
  total NUMERIC(10,2) NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  notes TEXT,
  amount_received NUMERIC(10,2),
  change_given NUMERIC(10,2),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  synced BOOLEAN DEFAULT true,
  CONSTRAINT sales_total_nonnegative CHECK (total >= 0),
  CONSTRAINT sales_payment_method_valid CHECK (payment_method IN ('cash', 'transfer')),
  CONSTRAINT sales_amount_received_nonnegative CHECK (amount_received IS NULL OR amount_received >= 0),
  CONSTRAINT sales_change_given_nonnegative CHECK (change_given IS NULL OR change_given >= 0)
);

CREATE UNIQUE INDEX idx_sales_idempotency_key
ON sales(idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- ============================================
-- DETALLE DE VENTAS
-- ============================================
CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_barcode TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES partners(id),
  quantity INT NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT sale_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT sale_items_unit_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT sale_items_subtotal_nonnegative CHECK (subtotal >= 0)
);

-- ============================================
-- GASTOS
-- ============================================
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id UUID NOT NULL REFERENCES cash_sessions(id),
  amount NUMERIC(10,2) NOT NULL,
  description TEXT NOT NULL,
  scope expense_scope NOT NULL,
  idempotency_key TEXT,
  registered_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  synced BOOLEAN DEFAULT true,
  CONSTRAINT expenses_amount_positive CHECK (amount > 0)
);

CREATE UNIQUE INDEX idx_expenses_idempotency_key
ON expenses(idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- ============================================
-- ASIGNACIÓN DE GASTOS
-- ============================================
CREATE TABLE expense_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES partners(id),
  amount NUMERIC(10,2) NOT NULL,
  CONSTRAINT expense_allocations_amount_nonnegative CHECK (amount >= 0)
);

-- ============================================
-- MOVIMIENTOS DE INVENTARIO
-- ============================================
CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity_change INT NOT NULL,
  reason inventory_movement_reason NOT NULL,
  reference_id UUID,
  performed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT inventory_movements_quantity_nonzero CHECK (quantity_change <> 0)
);

-- ============================================
-- VISTA: Reporte de Cierre de Caja
-- ============================================
CREATE OR REPLACE VIEW v_cash_session_report AS
SELECT
  cs.id AS session_id,
  cs.opened_at,
  cs.closed_at,
  p.id AS partner_id,
  p.name AS partner,
  p.display_name,
  p.color_hex,
  COALESCE(SUM(si.subtotal), 0) AS total_sales,
  COALESCE(
    (SELECT SUM(ea.amount)
     FROM expense_allocations ea
     JOIN expenses e ON e.id = ea.expense_id
     WHERE e.cash_session_id = cs.id AND ea.partner_id = p.id
    ), 0
  ) AS total_expenses,
  COALESCE(SUM(si.subtotal), 0) -
  COALESCE(
    (SELECT SUM(ea.amount)
     FROM expense_allocations ea
     JOIN expenses e ON e.id = ea.expense_id
     WHERE e.cash_session_id = cs.id AND ea.partner_id = p.id
    ), 0
  ) AS net_total
FROM cash_sessions cs
CROSS JOIN partners p
LEFT JOIN sales s ON s.cash_session_id = cs.id
LEFT JOIN sale_items si ON si.sale_id = s.id AND si.owner_id = p.id
GROUP BY cs.id, cs.opened_at, cs.closed_at, p.id, p.name, p.display_name, p.color_hex;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- All authenticated users have full access
CREATE POLICY "auth_all" ON partners FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON cash_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON sales FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON sale_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON expense_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON inventory_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);
