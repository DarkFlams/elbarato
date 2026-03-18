-- ============================================
-- Add missing details to sales table
-- ============================================

ALTER TABLE sales
ADD COLUMN notes TEXT,
ADD COLUMN amount_received NUMERIC(10,2),
ADD COLUMN change_given NUMERIC(10,2);

-- Update the register_sale function to accept the new params
DROP FUNCTION IF EXISTS register_sale(UUID, TEXT, JSONB);

CREATE OR REPLACE FUNCTION register_sale(
  p_cash_session_id UUID,
  p_payment_method TEXT,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL,
  p_amount_received NUMERIC(10,2) DEFAULT NULL,
  p_change_given NUMERIC(10,2) DEFAULT NULL
)
RETURNS TABLE (
  sale_id UUID,
  total NUMERIC(10,2),
  item_count INT
) AS $$
DECLARE
  v_sale_id UUID;
  v_total NUMERIC(10,2) := 0;
  v_item_count INT := 0;
  v_item JSONB;
  v_product RECORD;
  v_quantity INT;
  v_unit_price NUMERIC(10,2);
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_cash_session_id IS NULL THEN
    RAISE EXCEPTION 'Sesion de caja requerida';
  END IF;

  IF p_payment_method NOT IN ('cash', 'transfer') THEN
    RAISE EXCEPTION 'Metodo de pago invalido: %', p_payment_method;
  END IF;

  -- Verify session status
  IF NOT EXISTS (SELECT 1 FROM cash_sessions WHERE id = p_cash_session_id AND status = 'open') THEN
    RAISE EXCEPTION 'La sesion de caja no esta abierta';
  END IF;

  -- Create the sale header
  INSERT INTO sales (
    cash_session_id, 
    sold_by, 
    total, 
    payment_method,
    notes,
    amount_received,
    change_given
  )
  VALUES (
    p_cash_session_id, 
    auth.uid(), 
    0, -- Will be updated later
    p_payment_method,
    p_notes,
    p_amount_received,
    p_change_given
  ) RETURNING id INTO v_sale_id;

  -- Process items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::INT;
    v_unit_price := (v_item->>'unit_price')::NUMERIC(10,2);

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
    END IF;

    -- Get product with row-level lock
    SELECT * INTO v_product FROM products 
    WHERE id = (v_item->>'product_id')::UUID 
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado: %', (v_item->>'product_id');
    END IF;

    IF v_product.stock < v_quantity THEN
      RAISE EXCEPTION 'Stock insuficiente para el producto % (Queda: %)', v_product.name, v_product.stock;
    END IF;

    -- Update inventory
    UPDATE products SET 
      stock = stock - v_quantity,
      updated_at = now()
    WHERE id = v_product.id;

    -- Record movement (sale logic inside trigger or managed via app depending on implementation, 
    -- currently manually managed)
    INSERT INTO inventory_movements (product_id, quantity_change, reason, reference_id, performed_by)
    VALUES (v_product.id, -v_quantity, 'sale', v_sale_id, auth.uid());

    -- Create sale item
    INSERT INTO sale_items (
      sale_id, product_id, product_name, product_barcode, owner_id, quantity, unit_price, subtotal
    ) VALUES (
      v_sale_id, v_product.id, v_product.name, v_product.barcode, v_product.owner_id, v_quantity, v_unit_price, (v_quantity * v_unit_price)
    );

    v_total := v_total + (v_quantity * v_unit_price);
    v_item_count := v_item_count + v_quantity;
  END LOOP;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'No se enviaron productos para la venta';
  END IF;

  -- Update final total
  UPDATE sales SET total = v_total WHERE id = v_sale_id;

  RETURN QUERY SELECT v_sale_id, v_total, v_item_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
