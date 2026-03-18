-- ============================================
-- Migration: Bodega + Remate Feature
-- Adds old_stock movement reason, clearance columns, bodega_stock, and RPCs
-- ============================================

-- 1. New movement reason
ALTER TYPE inventory_movement_reason ADD VALUE IF NOT EXISTS 'old_stock';

-- 2. New columns on products
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_clearance BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS clearance_price NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS bodega_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS disposed_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS bodega_stock INT DEFAULT 0;

-- 3. Indexes for fast filtering
DROP INDEX IF EXISTS idx_products_bodega;
CREATE INDEX idx_products_bodega
  ON products(bodega_stock) WHERE bodega_stock > 0 AND disposed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_clearance
  ON products(is_clearance) WHERE is_clearance = true;
CREATE INDEX IF NOT EXISTS idx_products_disposed
  ON products(disposed_at) WHERE disposed_at IS NOT NULL;

-- ============================================
-- RPC: send_product_to_bodega
-- Moves stock to bodega. Partial or full.
-- If full (qty == stock), deactivates the product.
-- Always increments bodega_stock.
-- ============================================
CREATE OR REPLACE FUNCTION send_product_to_bodega(
  p_product_id UUID,
  p_quantity INT DEFAULT NULL
)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  units_removed INT,
  fully_retired BOOLEAN
) AS $$
DECLARE
  v_stock INT;
  v_name TEXT;
  v_qty INT;
  v_fully BOOLEAN := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT p.stock, p.name INTO v_stock, v_name
  FROM products p WHERE p.id = p_product_id AND p.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o ya esta inactivo';
  END IF;

  -- If no quantity given, send all
  v_qty := COALESCE(p_quantity, v_stock);

  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Cantidad invalida';
  END IF;

  IF v_qty > v_stock THEN
    RAISE EXCEPTION 'Cantidad mayor al stock disponible (%)', v_stock;
  END IF;

  IF v_qty = v_stock THEN
    -- Full retirement: deactivate + send to bodega
    UPDATE products
    SET is_active = false,
        bodega_at = now(),
        stock = 0,
        bodega_stock = bodega_stock + v_qty,
        updated_at = now()
    WHERE id = p_product_id;
    v_fully := true;
  ELSE
    -- Partial: reduce stock, increment bodega_stock, product stays active
    UPDATE products
    SET stock = stock - v_qty,
        bodega_stock = bodega_stock + v_qty,
        updated_at = now()
    WHERE id = p_product_id;
    v_fully := false;
  END IF;

  -- Record movement
  INSERT INTO inventory_movements (
    product_id, quantity_change, reason, reference_id, performed_by
  ) VALUES (
    p_product_id, -v_qty, 'old_stock', p_product_id, auth.uid()
  );

  RETURN QUERY SELECT p_product_id, v_name, v_qty, v_fully;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================
-- RPC: create_remate
-- Takes units from bodega_stock and reactivates them with a clearance price.
-- ============================================
CREATE OR REPLACE FUNCTION create_remate(
  p_product_id UUID,
  p_clearance_price NUMERIC(10,2),
  p_stock INT DEFAULT 0
)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  original_price NUMERIC,
  remate_price NUMERIC
) AS $$
DECLARE
  v_name TEXT;
  v_sale_price NUMERIC(10,2);
  v_bodega_stock INT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF COALESCE(p_clearance_price, 0) <= 0 THEN
    RAISE EXCEPTION 'Precio de remate invalido';
  END IF;

  SELECT p.name, p.sale_price, p.bodega_stock INTO v_name, v_sale_price, v_bodega_stock
  FROM products p WHERE p.id = p_product_id AND p.bodega_stock > 0 AND p.disposed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado en bodega';
  END IF;

  IF COALESCE(p_stock, 0) > v_bodega_stock THEN
    RAISE EXCEPTION 'No puedes reingresar mas unidades (%) de las que hay en bodega (%)', p_stock, v_bodega_stock;
  END IF;

  UPDATE products
  SET is_active = true,
      is_clearance = true,
      clearance_price = p_clearance_price,
      bodega_at = NULL,
      stock = stock + COALESCE(p_stock, 0),
      bodega_stock = bodega_stock - COALESCE(p_stock, 0),
      updated_at = now()
  WHERE id = p_product_id;

  -- Record restock movement if stock > 0
  IF COALESCE(p_stock, 0) > 0 THEN
    INSERT INTO inventory_movements (
      product_id, quantity_change, reason, reference_id, performed_by
    ) VALUES (
      p_product_id, p_stock, 'restock', p_product_id, auth.uid()
    );
  END IF;

  RETURN QUERY SELECT p_product_id, v_name, v_sale_price, p_clearance_price;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================
-- RPC: dispose_product
-- Marks bodega stock as disposed (permanent).
-- ============================================
CREATE OR REPLACE FUNCTION dispose_product(
  p_product_id UUID
)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT
) AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT p.name INTO v_name
  FROM products p WHERE p.id = p_product_id AND p.bodega_stock > 0 AND p.disposed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado en bodega';
  END IF;

  UPDATE products
  SET disposed_at = now(),
      bodega_stock = 0,
      updated_at = now()
  WHERE id = p_product_id;

  RETURN QUERY SELECT p_product_id, v_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================
-- RPC: remove_clearance
-- Removes clearance flag, reverts to normal price.
-- ============================================
CREATE OR REPLACE FUNCTION remove_clearance(
  p_product_id UUID
)
RETURNS VOID AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  UPDATE products
  SET is_clearance = false,
      clearance_price = NULL,
      updated_at = now()
  WHERE id = p_product_id AND is_clearance = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o no esta en remate';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
