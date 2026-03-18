-- ============================================
-- Migration: Add SKU column + Todos partner
-- Run this in Supabase SQL Editor BEFORE importing
-- ============================================

-- 1. Add SKU column to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

-- 2. Add 'todos' to partner_enum
ALTER TYPE partner_enum ADD VALUE IF NOT EXISTS 'todos';

-- 3. Insert 'Todos' partner (idempotent)
INSERT INTO partners (name, display_name, color_hex)
VALUES ('todos', 'Todos', '#8B7A62')
ON CONFLICT (name) DO NOTHING;

-- 4. Update upsert_product_with_movement to support SKU
CREATE OR REPLACE FUNCTION upsert_product_with_movement(
  p_product_id UUID,
  p_barcode TEXT,
  p_name TEXT,
  p_description TEXT,
  p_category TEXT,
  p_owner_id UUID,
  p_purchase_price NUMERIC(10,2),
  p_sale_price NUMERIC(10,2),
  p_stock INT,
  p_min_stock INT,
  p_is_active BOOLEAN DEFAULT true,
  p_sku TEXT DEFAULT NULL
)
RETURNS TABLE (
  product_id UUID,
  movement_delta INT
) AS $$
DECLARE
  v_product_id UUID;
  v_prev_stock INT := 0;
  v_delta INT := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF COALESCE(trim(p_barcode), '') = '' THEN
    RAISE EXCEPTION 'Codigo de barras requerido';
  END IF;

  IF COALESCE(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Nombre de producto requerido';
  END IF;

  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'Socia requerida';
  END IF;

  IF COALESCE(p_purchase_price, 0) < 0 THEN
    RAISE EXCEPTION 'Precio de compra invalido';
  END IF;

  IF COALESCE(p_sale_price, 0) <= 0 THEN
    RAISE EXCEPTION 'Precio de venta invalido';
  END IF;

  IF COALESCE(p_stock, 0) < 0 THEN
    RAISE EXCEPTION 'Stock invalido';
  END IF;

  IF COALESCE(p_min_stock, 0) < 0 THEN
    RAISE EXCEPTION 'Stock minimo invalido';
  END IF;

  IF p_product_id IS NULL THEN
    INSERT INTO products (
      barcode,
      sku,
      name,
      description,
      category,
      owner_id,
      purchase_price,
      sale_price,
      stock,
      min_stock,
      is_active
    )
    VALUES (
      p_barcode,
      NULLIF(trim(COALESCE(p_sku, '')), ''),
      trim(p_name),
      NULLIF(trim(COALESCE(p_description, '')), ''),
      NULLIF(trim(COALESCE(p_category, '')), ''),
      p_owner_id,
      COALESCE(p_purchase_price, 0),
      p_sale_price,
      COALESCE(p_stock, 0),
      COALESCE(p_min_stock, 0),
      COALESCE(p_is_active, true)
    )
    RETURNING id INTO v_product_id;

    v_delta := COALESCE(p_stock, 0);

    IF v_delta <> 0 THEN
      INSERT INTO inventory_movements (
        product_id,
        quantity_change,
        reason,
        reference_id,
        performed_by
      )
      VALUES (
        v_product_id,
        v_delta,
        'initial_stock',
        v_product_id,
        auth.uid()
      );
    END IF;
  ELSE
    SELECT stock
    INTO v_prev_stock
    FROM products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado';
    END IF;

    UPDATE products
    SET
      barcode = p_barcode,
      sku = NULLIF(trim(COALESCE(p_sku, '')), ''),
      name = trim(p_name),
      description = NULLIF(trim(COALESCE(p_description, '')), ''),
      category = NULLIF(trim(COALESCE(p_category, '')), ''),
      owner_id = p_owner_id,
      purchase_price = COALESCE(p_purchase_price, 0),
      sale_price = p_sale_price,
      stock = COALESCE(p_stock, 0),
      min_stock = COALESCE(p_min_stock, 0),
      is_active = COALESCE(p_is_active, true),
      updated_at = now()
    WHERE id = p_product_id;

    v_product_id := p_product_id;
    v_delta := COALESCE(p_stock, 0) - COALESCE(v_prev_stock, 0);

    IF v_delta <> 0 THEN
      INSERT INTO inventory_movements (
        product_id,
        quantity_change,
        reason,
        reference_id,
        performed_by
      )
      VALUES (
        v_product_id,
        v_delta,
        'manual_adjustment',
        v_product_id,
        auth.uid()
      );
    END IF;
  END IF;

  RETURN QUERY
  SELECT v_product_id, v_delta;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;
