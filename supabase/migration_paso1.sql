-- ============================================
-- PASO 1 de 2: Ejecuta ESTO PRIMERO, solo
-- ============================================

-- Agregar SKU column
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

-- Agregar 'todos' al enum
ALTER TYPE partner_enum ADD VALUE IF NOT EXISTS 'todos';
