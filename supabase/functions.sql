-- ============================================
-- FUNCIONES RPC (Ejecutar en Supabase SQL Editor)
-- ============================================
-- Estas funciones se llaman desde el frontend via supabase.rpc()

-- ============================================
-- HARDENING CONTABLE (idempotencia + columnas de checkout)
-- ============================================
ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_received NUMERIC(10,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_given NUMERIC(10,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_idempotency_key
ON sales(idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_expenses_idempotency_key
ON expenses(idempotency_key)
WHERE idempotency_key IS NOT NULL;

/**
 * decrement_stock
 * Descuenta stock de un producto de forma atomica.
 * Evita condiciones de carrera en ventas simultaneas.
 */
CREATE OR REPLACE FUNCTION decrement_stock(
  p_product_id UUID,
  p_quantity INT
)
RETURNS VOID AS $$
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Cantidad invalida para descuento: %', p_quantity;
  END IF;

  UPDATE products
  SET stock = stock - p_quantity,
      updated_at = now()
  WHERE id = p_product_id
    AND stock >= p_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se pudo descontar stock (producto inexistente o stock insuficiente)';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * increment_stock
 * Incrementa stock (para devoluciones o ingreso de inventario).
 */
CREATE OR REPLACE FUNCTION increment_stock(
  p_product_id UUID,
  p_quantity INT
)
RETURNS VOID AS $$
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Cantidad invalida para incremento: %', p_quantity;
  END IF;

  UPDATE products
  SET stock = stock + p_quantity,
      updated_at = now()
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado para incremento de stock';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * register_sale
 * Registra una venta completa de forma atomica.
 *
 * p_items espera un JSON array con objetos:
 * [
 *   {
 *     "product_id": "uuid",
 *     "quantity": 2,
 *     "unit_price": 15.50
 *   }
 * ]
 */
DROP FUNCTION IF EXISTS register_sale(UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS register_sale(UUID, TEXT, JSONB, TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS register_sale(UUID, TEXT, JSONB, TEXT, NUMERIC, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION register_sale(
  p_cash_session_id UUID,
  p_payment_method TEXT,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL,
  p_amount_received NUMERIC(10,2) DEFAULT NULL,
  p_change_given NUMERIC(10,2) DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
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
  v_existing_sale_id UUID;
  v_existing_total NUMERIC(10,2);
  v_existing_item_count INT;
  v_idempotency_key TEXT;
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

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe incluir al menos un item';
  END IF;

  IF p_amount_received IS NOT NULL AND p_amount_received < 0 THEN
    RAISE EXCEPTION 'Monto recibido invalido';
  END IF;

  IF p_change_given IS NOT NULL AND p_change_given < 0 THEN
    RAISE EXCEPTION 'Cambio invalido';
  END IF;

  v_idempotency_key := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');

  IF v_idempotency_key IS NOT NULL THEN
    SELECT
      s.id,
      s.total,
      COALESCE(SUM(si.quantity), 0)::INT
    INTO
      v_existing_sale_id,
      v_existing_total,
      v_existing_item_count
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE s.idempotency_key = v_idempotency_key
    GROUP BY s.id, s.total;

    IF FOUND THEN
      RETURN QUERY
      SELECT v_existing_sale_id, v_existing_total, v_existing_item_count;
      RETURN;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM cash_sessions
    WHERE id = p_cash_session_id
      AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'La sesion de caja no existe o ya fue cerrada';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE(v_item->>'product_id', '') = '' THEN
      RAISE EXCEPTION 'Hay un item sin product_id';
    END IF;

    v_quantity := COALESCE((v_item->>'quantity')::INT, 0);
    v_unit_price := ROUND(COALESCE((v_item->>'unit_price')::NUMERIC, 0), 2);

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Cantidad invalida para el producto %', v_item->>'product_id';
    END IF;

    IF v_unit_price < 0 THEN
      RAISE EXCEPTION 'Precio invalido para el producto %', v_item->>'product_id';
    END IF;

    SELECT
      id,
      name,
      barcode,
      owner_id,
      stock,
      is_active
    INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id')::UUID
    FOR UPDATE;

    IF NOT FOUND OR NOT v_product.is_active THEN
      RAISE EXCEPTION 'Producto no encontrado o inactivo: %', v_item->>'product_id';
    END IF;

    IF v_product.stock < v_quantity THEN
      RAISE EXCEPTION 'Stock insuficiente para %', v_product.name;
    END IF;

    v_total := v_total + ROUND(v_quantity * v_unit_price, 2);
    v_item_count := v_item_count + v_quantity;
  END LOOP;

  BEGIN
    INSERT INTO sales (
      cash_session_id,
      sold_by,
      total,
      payment_method,
      notes,
      amount_received,
      change_given,
      synced,
      idempotency_key
    )
    VALUES (
      p_cash_session_id,
      auth.uid(),
      v_total,
      p_payment_method,
      NULLIF(trim(COALESCE(p_notes, '')), ''),
      CASE
        WHEN p_payment_method = 'cash' THEN ROUND(COALESCE(p_amount_received, 0), 2)
        ELSE NULL
      END,
      CASE
        WHEN p_payment_method = 'cash' THEN ROUND(COALESCE(p_change_given, 0), 2)
        ELSE NULL
      END,
      true,
      v_idempotency_key
    )
    RETURNING id INTO v_sale_id;
  EXCEPTION
    WHEN unique_violation THEN
      IF v_idempotency_key IS NOT NULL THEN
        SELECT
          s.id,
          s.total,
          COALESCE(SUM(si.quantity), 0)::INT
        INTO
          v_existing_sale_id,
          v_existing_total,
          v_existing_item_count
        FROM sales s
        LEFT JOIN sale_items si ON si.sale_id = s.id
        WHERE s.idempotency_key = v_idempotency_key
        GROUP BY s.id, s.total;

        IF FOUND THEN
          RETURN QUERY
          SELECT v_existing_sale_id, v_existing_total, v_existing_item_count;
          RETURN;
        END IF;
      END IF;

      RAISE;
  END;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::INT;
    v_unit_price := ROUND((v_item->>'unit_price')::NUMERIC, 2);

    SELECT
      id,
      name,
      barcode,
      owner_id
    INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id')::UUID;

    UPDATE products
    SET stock = stock - v_quantity,
        updated_at = now()
    WHERE id = v_product.id
      AND stock >= v_quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No fue posible descontar stock para %', v_product.name;
    END IF;

    INSERT INTO sale_items (
      sale_id,
      product_id,
      product_name,
      product_barcode,
      owner_id,
      quantity,
      unit_price,
      subtotal
    )
    VALUES (
      v_sale_id,
      v_product.id,
      v_product.name,
      v_product.barcode,
      v_product.owner_id,
      v_quantity,
      v_unit_price,
      ROUND(v_quantity * v_unit_price, 2)
    );

    INSERT INTO inventory_movements (
      product_id,
      quantity_change,
      reason,
      reference_id,
      performed_by
    )
    VALUES (
      v_product.id,
      -v_quantity,
      'sale',
      v_sale_id,
      auth.uid()
    );
  END LOOP;

  RETURN QUERY
  SELECT v_sale_id, v_total, v_item_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

/**
 * upsert_expense_with_allocations
 * Crea/edita gastos y sus asignaciones en una sola transaccion.
 * Incluye idempotencia para alta de gastos.
 */
CREATE OR REPLACE FUNCTION upsert_expense_with_allocations(
  p_expense_id UUID DEFAULT NULL,
  p_cash_session_id UUID DEFAULT NULL,
  p_amount NUMERIC(10,2) DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_scope expense_scope DEFAULT 'shared',
  p_partner_id UUID DEFAULT NULL,
  p_shared_partner_ids UUID[] DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  expense_id UUID,
  allocation_count INT
) AS $$
DECLARE
  v_expense_id UUID;
  v_key TEXT;
  v_allocation_count INT := 0;
  v_partner_count INT := 0;
  v_share NUMERIC(10,2);
  v_remainder NUMERIC(10,2);
  v_index INT := 0;
  v_partner_uuid UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Monto invalido';
  END IF;

  IF COALESCE(trim(p_description), '') = '' THEN
    RAISE EXCEPTION 'Descripcion requerida';
  END IF;

  IF p_scope = 'individual' AND p_partner_id IS NULL THEN
    RAISE EXCEPTION 'Socia requerida para gasto individual';
  END IF;

  IF p_scope = 'shared' AND COALESCE(array_length(p_shared_partner_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'No hay socias para distribuir gasto compartido';
  END IF;

  v_key := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');

  IF p_expense_id IS NULL THEN
    IF p_cash_session_id IS NULL THEN
      RAISE EXCEPTION 'Sesion de caja requerida para registrar gasto';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM cash_sessions
      WHERE id = p_cash_session_id
        AND status = 'open'
    ) THEN
      RAISE EXCEPTION 'La sesion de caja no existe o ya fue cerrada';
    END IF;

    IF v_key IS NOT NULL THEN
      SELECT id
      INTO v_expense_id
      FROM expenses
      WHERE idempotency_key = v_key
      LIMIT 1;

      IF FOUND THEN
        SELECT COUNT(*)::INT
        INTO v_allocation_count
        FROM expense_allocations
        WHERE expense_id = v_expense_id;

        RETURN QUERY
        SELECT v_expense_id, v_allocation_count;
        RETURN;
      END IF;
    END IF;

    BEGIN
      INSERT INTO expenses (
        cash_session_id,
        amount,
        description,
        scope,
        registered_by,
        synced,
        idempotency_key
      )
      VALUES (
        p_cash_session_id,
        ROUND(p_amount, 2),
        trim(p_description),
        p_scope,
        auth.uid(),
        true,
        v_key
      )
      RETURNING id INTO v_expense_id;
    EXCEPTION
      WHEN unique_violation THEN
        IF v_key IS NOT NULL THEN
          SELECT id
          INTO v_expense_id
          FROM expenses
          WHERE idempotency_key = v_key
          LIMIT 1;

          IF FOUND THEN
            SELECT COUNT(*)::INT
            INTO v_allocation_count
            FROM expense_allocations
            WHERE expense_id = v_expense_id;

            RETURN QUERY
            SELECT v_expense_id, v_allocation_count;
            RETURN;
          END IF;
        END IF;

        RAISE;
    END;
  ELSE
    SELECT id
    INTO v_expense_id
    FROM expenses
    WHERE id = p_expense_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gasto no encontrado';
    END IF;

    UPDATE expenses
    SET
      amount = ROUND(p_amount, 2),
      description = trim(p_description),
      scope = p_scope
    WHERE id = v_expense_id;

    DELETE FROM expense_allocations
    WHERE expense_id = v_expense_id;
  END IF;

  IF p_scope = 'individual' THEN
    INSERT INTO expense_allocations (
      expense_id,
      partner_id,
      amount
    )
    VALUES (
      v_expense_id,
      p_partner_id,
      ROUND(p_amount, 2)
    );

    v_allocation_count := 1;
  ELSE
    v_partner_count := array_length(p_shared_partner_ids, 1);
    v_share := ROUND(p_amount / v_partner_count, 2);
    v_remainder := ROUND(p_amount - (v_share * v_partner_count), 2);

    FOREACH v_partner_uuid IN ARRAY p_shared_partner_ids LOOP
      v_index := v_index + 1;

      INSERT INTO expense_allocations (
        expense_id,
        partner_id,
        amount
      )
      VALUES (
        v_expense_id,
        v_partner_uuid,
        CASE
          WHEN v_index = 1 THEN ROUND(v_share + v_remainder, 2)
          ELSE v_share
        END
      );
    END LOOP;

    v_allocation_count := v_partner_count;
  END IF;

  RETURN QUERY
  SELECT v_expense_id, v_allocation_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

/**
 * upsert_product_with_movement
 * Crea o actualiza un producto y registra movimiento de inventario
 * en la misma transaccion.
 */
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

/**
 * adjust_product_stock
 * Registra altas/bajas de stock con movimiento auditado.
 */
CREATE OR REPLACE FUNCTION adjust_product_stock(
  p_product_id UUID,
  p_quantity INT,
  p_operation TEXT,
  p_reason inventory_movement_reason DEFAULT 'manual_adjustment'
)
RETURNS TABLE (
  product_id UUID,
  new_stock INT,
  movement_delta INT
) AS $$
DECLARE
  v_delta INT;
  v_new_stock INT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Producto requerido';
  END IF;

  IF COALESCE(p_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'Cantidad invalida';
  END IF;

  IF p_operation NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'Operacion invalida: %', p_operation;
  END IF;

  IF p_reason IN ('sale', 'initial_stock') THEN
    RAISE EXCEPTION 'Motivo no permitido para ajuste manual: %', p_reason;
  END IF;

  v_delta := CASE WHEN p_operation = 'in' THEN p_quantity ELSE -p_quantity END;

  UPDATE products
  SET stock = stock + v_delta,
      updated_at = now()
  WHERE id = p_product_id
    AND (v_delta >= 0 OR stock >= ABS(v_delta))
  RETURNING stock INTO v_new_stock;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se pudo ajustar stock (producto no existe o stock insuficiente)';
  END IF;

  INSERT INTO inventory_movements (
    product_id,
    quantity_change,
    reason,
    reference_id,
    performed_by
  )
  VALUES (
    p_product_id,
    v_delta,
    p_reason,
    p_product_id,
    auth.uid()
  );

  RETURN QUERY
  SELECT p_product_id, v_new_stock, v_delta;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;
