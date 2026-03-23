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
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price_x3 NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price_x6 NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price_x12 NUMERIC(10,2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price_tier TEXT DEFAULT 'normal';

UPDATE sale_items
SET price_tier = 'normal'
WHERE price_tier IS NULL
   OR trim(price_tier) = '';

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
      stock_revision = stock_revision + 1,
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
      stock_revision = stock_revision + 1,
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
 *     "unit_price": 15.50,
 *     "price_tier": "normal"
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
  v_price_tier TEXT;
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
    v_price_tier := lower(trim(COALESCE(v_item->>'price_tier', 'normal')));

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Cantidad invalida para el producto %', v_item->>'product_id';
    END IF;

    IF v_unit_price < 0 THEN
      RAISE EXCEPTION 'Precio invalido para el producto %', v_item->>'product_id';
    END IF;

    IF v_price_tier NOT IN ('normal', 'x3', 'x6', 'x12', 'manual') THEN
      RAISE EXCEPTION 'Tier de precio invalido para el producto %', v_item->>'product_id';
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
    v_price_tier := lower(trim(COALESCE(v_item->>'price_tier', 'normal')));

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
        stock_revision = stock_revision + 1,
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
      price_tier,
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
      v_price_tier,
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
 * issue_mobile_access_code
 * Emite un codigo temporal para acceso movil de inventario.
 */
DROP FUNCTION IF EXISTS issue_mobile_access_code(INT);

CREATE OR REPLACE FUNCTION issue_mobile_access_code(
  p_ttl_minutes INT DEFAULT 60
)
RETURNS TABLE (
  access_code_id UUID,
  code TEXT,
  qr_token TEXT,
  expires_at TIMESTAMPTZ
) AS $$
DECLARE
  v_code TEXT;
  v_qr_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_id UUID;
  v_attempt INT := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF COALESCE(p_ttl_minutes, 0) <= 0 OR p_ttl_minutes > 1440 THEN
    RAISE EXCEPTION 'TTL invalido. Debe estar entre 1 y 1440 minutos';
  END IF;

  v_expires_at := now() + make_interval(mins => p_ttl_minutes);

  LOOP
    v_attempt := v_attempt + 1;
    EXIT WHEN v_attempt > 20;

    -- Codigo manual simple: 6 digitos numericos.
    v_code := lpad((floor(random() * 1000000)::INT)::TEXT, 6, '0');
    v_qr_token := replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', '');

    BEGIN
      INSERT INTO mobile_access_codes (
        code,
        qr_token,
        issued_by,
        expires_at
      )
      VALUES (
        v_code,
        v_qr_token,
        auth.uid(),
        v_expires_at
      )
      RETURNING id INTO v_id;

      RETURN QUERY
      SELECT v_id, v_code, v_qr_token, v_expires_at;
      RETURN;
    EXCEPTION
      WHEN unique_violation THEN
        -- Reintento de generacion de codigo/token.
        CONTINUE;
    END;
  END LOOP;

  RAISE EXCEPTION 'No se pudo generar codigo de acceso. Intenta nuevamente';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

/**
 * consume_mobile_access_code
 * Consume un codigo/token y abre sesion temporal para operador movil.
 */
DROP FUNCTION IF EXISTS consume_mobile_access_code(TEXT, TEXT);

CREATE OR REPLACE FUNCTION consume_mobile_access_code(
  p_code_or_token TEXT,
  p_operator_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  session_id UUID,
  access_code_id UUID,
  scope TEXT,
  expires_at TIMESTAMPTZ
) AS $$
DECLARE
  v_lookup_raw TEXT;
  v_lookup_alnum TEXT;
  v_lookup_upper TEXT;
  v_lookup_lower TEXT;
  v_lookup_code TEXT;
  v_lookup_code_legacy TEXT;
  v_access RECORD;
  v_existing_session RECORD;
  v_session_id UUID;
  v_operator_name TEXT;
BEGIN
  v_lookup_raw := trim(COALESCE(p_code_or_token, ''));
  IF v_lookup_raw = '' THEN
    RAISE EXCEPTION 'Codigo o token requerido';
  END IF;

  v_lookup_alnum := regexp_replace(v_lookup_raw, '[^A-Za-z0-9]', '', 'g');
  IF v_lookup_alnum = '' THEN
    RAISE EXCEPTION 'Codigo o token requerido';
  END IF;

  v_lookup_upper := upper(v_lookup_alnum);
  v_lookup_lower := lower(v_lookup_alnum);
  v_lookup_code := v_lookup_upper;
  v_lookup_code_legacy := NULL;

  -- Compatibilidad con codigos antiguos tipo ABC-123 cuando el usuario escribe ABC123.
  IF length(v_lookup_upper) = 6 THEN
    v_lookup_code_legacy := substr(v_lookup_upper, 1, 3) || '-' || substr(v_lookup_upper, 4, 3);
  END IF;

  v_operator_name := NULLIF(trim(COALESCE(p_operator_name, '')), '');

  SELECT
    mac.id,
    mac.expires_at
  INTO v_access
  FROM mobile_access_codes mac
  WHERE mac.revoked_at IS NULL
    AND mac.consumed_at IS NULL
    AND mac.expires_at > now()
    AND (
      mac.code = v_lookup_code
      OR (v_lookup_code_legacy IS NOT NULL AND mac.code = v_lookup_code_legacy)
      OR mac.qr_token = v_lookup_lower
    )
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF FOUND THEN
    UPDATE mobile_access_codes
    SET consumed_at = now()
    WHERE id = v_access.id;

    INSERT INTO mobile_sessions (
      access_code_id,
      operator_name,
      scope,
      expires_at,
      last_seen_at
    )
    VALUES (
      v_access.id,
      v_operator_name,
      'stock_only',
      v_access.expires_at,
      now()
    )
    RETURNING id INTO v_session_id;

    RETURN QUERY
    SELECT v_session_id, v_access.id, 'stock_only'::TEXT, v_access.expires_at;
    RETURN;
  END IF;

  SELECT
    mac.id,
    mac.expires_at
  INTO v_access
  FROM mobile_access_codes mac
  WHERE mac.revoked_at IS NULL
    AND mac.expires_at > now()
    AND (
      mac.code = v_lookup_code
      OR (v_lookup_code_legacy IS NOT NULL AND mac.code = v_lookup_code_legacy)
      OR mac.qr_token = v_lookup_lower
    )
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Codigo invalido o expirado';
  END IF;

  SELECT
    ms.id,
    ms.expires_at
  INTO v_existing_session
  FROM mobile_sessions ms
  WHERE ms.access_code_id = v_access.id
    AND ms.revoked_at IS NULL
    AND ms.expires_at > now()
  ORDER BY ms.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE mobile_sessions
    SET
      operator_name = COALESCE(v_operator_name, operator_name),
      last_seen_at = now()
    WHERE id = v_existing_session.id;

    RETURN QUERY
    SELECT v_existing_session.id, v_access.id, 'stock_only'::TEXT, v_existing_session.expires_at;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Codigo invalido, expirado o ya usado';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

/**
 * touch_mobile_session
 * Renueva heartbeat de sesion movil activa.
 */
DROP FUNCTION IF EXISTS touch_mobile_session(UUID);

CREATE OR REPLACE FUNCTION touch_mobile_session(
  p_session_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE mobile_sessions
  SET last_seen_at = now()
  WHERE id = p_session_id
    AND revoked_at IS NULL
    AND expires_at > now();

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

/**
 * revoke_mobile_session
 * Revoca una sesion movil desde desktop.
 */
DROP FUNCTION IF EXISTS revoke_mobile_session(UUID);

CREATE OR REPLACE FUNCTION revoke_mobile_session(
  p_session_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE mobile_sessions
  SET revoked_at = now()
  WHERE id = p_session_id
    AND revoked_at IS NULL;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

/**
 * apply_stock_count_adjustment
 * Ajuste por conteo fisico con concurrencia optimista por stock_revision.
 */
DROP FUNCTION IF EXISTS apply_stock_count_adjustment(UUID, INT, BIGINT, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION apply_stock_count_adjustment(
  p_product_id UUID,
  p_counted_stock INT,
  p_expected_revision BIGINT,
  p_reason TEXT DEFAULT 'physical_count',
  p_source TEXT DEFAULT 'mobile_count',
  p_session_id UUID DEFAULT NULL
)
RETURNS TABLE (
  status TEXT,
  product_id UUID,
  stock_before INT,
  stock_after INT,
  delta INT,
  expected_revision BIGINT,
  actual_revision BIGINT,
  new_revision BIGINT,
  adjustment_id UUID
) AS $$
DECLARE
  v_product RECORD;
  v_delta INT;
  v_new_revision BIGINT;
  v_adjustment_id UUID;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Producto requerido';
  END IF;

  IF COALESCE(p_counted_stock, -1) < 0 THEN
    RAISE EXCEPTION 'Conteo fisico invalido';
  END IF;

  IF COALESCE(p_expected_revision, 0) <= 0 THEN
    RAISE EXCEPTION 'Revision esperada invalida';
  END IF;

  IF p_source NOT IN ('mobile_count', 'desktop_manual', 'audit_round') THEN
    RAISE EXCEPTION 'Source invalido: %', p_source;
  END IF;

  IF p_source IN ('mobile_count', 'audit_round') THEN
    IF p_session_id IS NULL THEN
      RAISE EXCEPTION 'Sesion movil requerida para source %', p_source;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM mobile_sessions
      WHERE id = p_session_id
        AND revoked_at IS NULL
        AND expires_at > now()
    ) THEN
      RAISE EXCEPTION 'Sesion movil invalida o expirada';
    END IF;
  END IF;

  SELECT
    id,
    stock,
    stock_revision,
    is_active
  INTO v_product
  FROM products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_product.is_active THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

  IF v_product.stock_revision <> p_expected_revision THEN
    RETURN QUERY
    SELECT
      'conflict'::TEXT,
      v_product.id,
      v_product.stock,
      v_product.stock,
      0,
      p_expected_revision,
      v_product.stock_revision,
      v_product.stock_revision,
      NULL::UUID;
    RETURN;
  END IF;

  v_delta := p_counted_stock - v_product.stock;

  UPDATE products
  SET
    stock = p_counted_stock,
    stock_revision = stock_revision + 1,
    updated_at = now()
  WHERE id = v_product.id
  RETURNING stock_revision INTO v_new_revision;

  IF v_delta <> 0 THEN
    INSERT INTO inventory_movements (
      product_id,
      quantity_change,
      reason,
      reference_id,
      performed_by
    )
    VALUES (
      v_product.id,
      v_delta,
      'manual_adjustment',
      v_product.id,
      auth.uid()
    );
  END IF;

  INSERT INTO stock_adjustments (
    product_id,
    performed_by_session_id,
    source,
    reason,
    stock_before,
    stock_counted,
    delta,
    stock_revision_before,
    stock_revision_after,
    review_status
  )
  VALUES (
    v_product.id,
    p_session_id,
    p_source,
    COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'physical_count'),
    v_product.stock,
    p_counted_stock,
    v_delta,
    v_product.stock_revision,
    v_new_revision,
    'auto_applied'
  )
  RETURNING id INTO v_adjustment_id;

  RETURN QUERY
  SELECT
    'ok'::TEXT,
    v_product.id,
    v_product.stock,
    p_counted_stock,
    v_delta,
    p_expected_revision,
    v_product.stock_revision,
    v_new_revision,
    v_adjustment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

/**
 * find_stock_mobile_product
 * Busca producto activo para modulo movil validando sesion vigente.
 * Prioriza coincidencia exacta de barcode/SKU y luego nombre.
 */
DROP FUNCTION IF EXISTS find_stock_mobile_product(TEXT, UUID);

CREATE OR REPLACE FUNCTION find_stock_mobile_product(
  p_query TEXT,
  p_session_id UUID
)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  product_barcode TEXT,
  product_sku TEXT,
  stock INT,
  stock_revision BIGINT,
  owner_id UUID,
  owner_name TEXT,
  owner_display_name TEXT,
  owner_color_hex TEXT
) AS $$
DECLARE
  v_query_raw TEXT;
  v_query_alnum TEXT;
BEGIN
  v_query_raw := trim(COALESCE(p_query, ''));
  IF v_query_raw = '' THEN
    RAISE EXCEPTION 'Codigo, SKU o nombre requerido';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Sesion movil requerida';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM mobile_sessions
    WHERE id = p_session_id
      AND revoked_at IS NULL
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Sesion movil invalida o expirada';
  END IF;

  v_query_alnum := upper(regexp_replace(v_query_raw, '[^A-Za-z0-9]', '', 'g'));

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.barcode,
    p.sku,
    p.stock,
    p.stock_revision,
    pa.id,
    pa.name::TEXT,
    pa.display_name,
    pa.color_hex
  FROM products p
  JOIN partners pa ON pa.id = p.owner_id
  WHERE p.is_active = true
    AND (
      (
        v_query_alnum <> ''
        AND upper(regexp_replace(COALESCE(p.barcode, ''), '[^A-Za-z0-9]', '', 'g')) = v_query_alnum
      )
      OR (
        v_query_alnum <> ''
        AND upper(regexp_replace(COALESCE(p.sku, ''), '[^A-Za-z0-9]', '', 'g')) = v_query_alnum
      )
      OR p.name ILIKE '%' || v_query_raw || '%'
    )
  ORDER BY
    CASE
      WHEN (
        v_query_alnum <> ''
        AND upper(regexp_replace(COALESCE(p.barcode, ''), '[^A-Za-z0-9]', '', 'g')) = v_query_alnum
      ) THEN 1
      WHEN (
        v_query_alnum <> ''
        AND upper(regexp_replace(COALESCE(p.sku, ''), '[^A-Za-z0-9]', '', 'g')) = v_query_alnum
      ) THEN 2
      WHEN p.name ILIKE v_query_raw || '%' THEN 3
      ELSE 4
    END,
    p.name
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION consume_mobile_access_code(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION touch_mobile_session(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION issue_mobile_access_code(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_mobile_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_stock_count_adjustment(UUID, INT, BIGINT, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION find_stock_mobile_product(TEXT, UUID) TO anon, authenticated;

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
DROP FUNCTION IF EXISTS upsert_product_with_movement(UUID, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC, INT, INT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS upsert_product_with_movement(UUID, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC, INT, INT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS upsert_product_with_movement(UUID, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INT, INT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS upsert_product_with_movement(UUID, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC, INT, INT, BOOLEAN, TEXT, NUMERIC, NUMERIC, NUMERIC);

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
  p_sku TEXT DEFAULT NULL,
  p_sale_price_x3 NUMERIC(10,2) DEFAULT NULL,
  p_sale_price_x6 NUMERIC(10,2) DEFAULT NULL,
  p_sale_price_x12 NUMERIC(10,2) DEFAULT NULL
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

  IF p_sale_price_x3 IS NOT NULL AND p_sale_price_x3 < 0 THEN
    RAISE EXCEPTION 'Precio x3 invalido';
  END IF;

  IF p_sale_price_x6 IS NOT NULL AND p_sale_price_x6 < 0 THEN
    RAISE EXCEPTION 'Precio x6 invalido';
  END IF;

  IF p_sale_price_x12 IS NOT NULL AND p_sale_price_x12 < 0 THEN
    RAISE EXCEPTION 'Precio x12 invalido';
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
      sale_price_x3,
      sale_price_x6,
      sale_price_x12,
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
      p_sale_price_x3,
      p_sale_price_x6,
      p_sale_price_x12,
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
      sale_price_x3 = p_sale_price_x3,
      sale_price_x6 = p_sale_price_x6,
      sale_price_x12 = p_sale_price_x12,
      stock = COALESCE(p_stock, 0),
      min_stock = COALESCE(p_min_stock, 0),
      stock_revision = CASE
        WHEN COALESCE(p_stock, 0) <> COALESCE(v_prev_stock, 0) THEN stock_revision + 1
        ELSE stock_revision
      END,
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
      stock_revision = stock_revision + 1,
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

-- Refresca el schema cache de PostgREST para que las RPC nuevas queden visibles
-- inmediatamente despues de ejecutar este archivo en Supabase SQL Editor.
NOTIFY pgrst, 'reload schema';
