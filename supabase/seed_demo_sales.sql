-- ============================================
-- SEED DEMO SALES (SOLO PRUEBAS)
-- ============================================
-- Crea tickets de prueba para reportes/historial sin tocar stock
-- ni registrar inventory_movements.
--
-- Uso sugerido:
--   SELECT * FROM seed_demo_sales_range('2026-03-01', '2026-03-31', 20, 40, 'MARZO-2026-DEMO');
--
-- Limpieza:
--   SELECT * FROM cleanup_seed_demo_sales('MARZO-2026-DEMO');

DROP FUNCTION IF EXISTS seed_demo_sales_range(DATE, DATE, INT, INT, TEXT);
DROP FUNCTION IF EXISTS cleanup_seed_demo_sales(TEXT);

CREATE OR REPLACE FUNCTION seed_demo_sales_range(
  p_from_date DATE,
  p_to_date DATE,
  p_min_sales_per_day INT DEFAULT 20,
  p_max_sales_per_day INT DEFAULT 40,
  p_tag TEXT DEFAULT 'MARZO-2026-DEMO'
)
RETURNS TABLE (
  days_seeded INT,
  sessions_created INT,
  sales_created INT,
  items_created INT
) AS $$
DECLARE
  v_day DATE;
  v_tag TEXT;
  v_prefix TEXT;
  v_session_id UUID;
  v_sale_id UUID;
  v_sale_ts TIMESTAMPTZ;
  v_sales_today INT;
  v_items_this_sale INT;
  v_total NUMERIC(10,2);
  v_unit_price NUMERIC(10,2);
  v_qty INT;
  v_payment_method TEXT;
  v_days_seeded INT := 0;
  v_sessions_created INT := 0;
  v_sales_created INT := 0;
  v_items_created INT := 0;
  v_product RECORD;
BEGIN
  v_tag := COALESCE(NULLIF(trim(p_tag), ''), 'MARZO-2026-DEMO');
  v_prefix := '[seed:' || v_tag || ']';

  IF p_from_date IS NULL OR p_to_date IS NULL THEN
    RAISE EXCEPTION 'Debes indicar fecha inicial y fecha final';
  END IF;

  IF p_to_date < p_from_date THEN
    RAISE EXCEPTION 'La fecha final no puede ser menor a la inicial';
  END IF;

  IF p_min_sales_per_day <= 0 OR p_max_sales_per_day <= 0 THEN
    RAISE EXCEPTION 'El rango diario debe ser mayor a cero';
  END IF;

  IF p_min_sales_per_day > p_max_sales_per_day THEN
    RAISE EXCEPTION 'El minimo diario no puede ser mayor que el maximo diario';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sales s
    WHERE s.notes LIKE v_prefix || ' sale %'
  ) THEN
    RAISE EXCEPTION 'Ya existen tickets demo para el tag %', v_tag;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM products p
    WHERE p.is_active = true
  ) THEN
    RAISE EXCEPTION 'No hay productos activos para generar tickets demo';
  END IF;

  v_day := p_from_date;

  WHILE v_day <= p_to_date LOOP
    v_days_seeded := v_days_seeded + 1;

    INSERT INTO cash_sessions (
      opened_by,
      opened_at,
      closed_at,
      opening_cash,
      closing_cash,
      status,
      notes
    )
    VALUES (
      NULL,
      make_timestamptz(
        EXTRACT(YEAR FROM v_day)::INT,
        EXTRACT(MONTH FROM v_day)::INT,
        EXTRACT(DAY FROM v_day)::INT,
        8,
        0,
        0,
        'America/Bogota'
      ),
      make_timestamptz(
        EXTRACT(YEAR FROM v_day)::INT,
        EXTRACT(MONTH FROM v_day)::INT,
        EXTRACT(DAY FROM v_day)::INT,
        20,
        0,
        0,
        'America/Bogota'
      ),
      100,
      100,
      'closed',
      v_prefix || ' session ' || to_char(v_day, 'YYYY-MM-DD')
    )
    RETURNING id INTO v_session_id;

    v_sessions_created := v_sessions_created + 1;
    v_sales_today := floor(random() * (p_max_sales_per_day - p_min_sales_per_day + 1) + p_min_sales_per_day)::INT;

    FOR i IN 1..v_sales_today LOOP
      v_sale_ts :=
        make_timestamptz(
          EXTRACT(YEAR FROM v_day)::INT,
          EXTRACT(MONTH FROM v_day)::INT,
          EXTRACT(DAY FROM v_day)::INT,
          9,
          0,
          0,
          'America/Bogota'
        )
        + make_interval(secs => floor(random() * 39600)::INT);

      v_payment_method := CASE
        WHEN random() < 0.68 THEN 'cash'
        ELSE 'transfer'
      END;

      INSERT INTO sales (
        cash_session_id,
        sold_by,
        total,
        payment_method,
        notes,
        amount_received,
        change_given,
        synced,
        created_at
      )
      VALUES (
        v_session_id,
        NULL,
        0,
        v_payment_method,
        v_prefix || ' sale ' || to_char(v_sale_ts AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI:SS'),
        NULL,
        NULL,
        true,
        v_sale_ts
      )
      RETURNING id INTO v_sale_id;

      v_total := 0;
      v_items_this_sale := CASE
        WHEN random() < 0.62 THEN 1
        WHEN random() < 0.9 THEN 2
        ELSE 3
      END;

      FOR v_product IN
        SELECT
          p.id,
          p.name,
          p.barcode,
          p.owner_id,
          p.sale_price,
          p.sale_price_x3,
          p.sale_price_x6,
          p.sale_price_x12
        FROM products p
        WHERE p.is_active = true
        ORDER BY random()
        LIMIT v_items_this_sale
      LOOP
        v_qty := CASE
          WHEN random() < 0.70 THEN 1
          WHEN random() < 0.86 THEN 3
          WHEN random() < 0.96 THEN 6
          ELSE 12
        END;

        v_unit_price := CASE
          WHEN v_qty >= 12 AND v_product.sale_price_x12 IS NOT NULL THEN v_product.sale_price_x12
          WHEN v_qty >= 6 AND v_product.sale_price_x6 IS NOT NULL THEN v_product.sale_price_x6
          WHEN v_qty >= 3 AND v_product.sale_price_x3 IS NOT NULL THEN v_product.sale_price_x3
          ELSE v_product.sale_price
        END;

        INSERT INTO sale_items (
          sale_id,
          product_id,
          product_name,
          product_barcode,
          owner_id,
          quantity,
          unit_price,
          price_tier,
          subtotal,
          created_at
        )
        VALUES (
          v_sale_id,
          v_product.id,
          v_product.name,
          v_product.barcode,
          v_product.owner_id,
          v_qty,
          ROUND(v_unit_price, 2),
          CASE
            WHEN v_qty >= 12 AND v_product.sale_price_x12 IS NOT NULL THEN 'x12'
            WHEN v_qty >= 6 AND v_product.sale_price_x6 IS NOT NULL THEN 'x6'
            WHEN v_qty >= 3 AND v_product.sale_price_x3 IS NOT NULL THEN 'x3'
            ELSE 'normal'
          END,
          ROUND(v_qty * v_unit_price, 2),
          v_sale_ts
        );

        v_total := v_total + ROUND(v_qty * v_unit_price, 2);
        v_items_created := v_items_created + 1;
      END LOOP;

      UPDATE sales s
      SET
        total = ROUND(v_total, 2),
        amount_received = CASE
          WHEN v_payment_method = 'cash' THEN ROUND(v_total, 2)
          ELSE NULL
        END,
        change_given = CASE
          WHEN v_payment_method = 'cash' THEN 0
          ELSE NULL
        END
      WHERE s.id = v_sale_id;

      v_sales_created := v_sales_created + 1;
    END LOOP;

    v_day := v_day + 1;
  END LOOP;

  RETURN QUERY
  SELECT
    v_days_seeded,
    v_sessions_created,
    v_sales_created,
    v_items_created;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_seed_demo_sales(
  p_tag TEXT DEFAULT 'MARZO-2026-DEMO'
)
RETURNS TABLE (
  deleted_sales INT,
  deleted_sessions INT
) AS $$
DECLARE
  v_tag TEXT;
  v_prefix TEXT;
  v_deleted_sales INT := 0;
  v_deleted_sessions INT := 0;
BEGIN
  v_tag := COALESCE(NULLIF(trim(p_tag), ''), 'MARZO-2026-DEMO');
  v_prefix := '[seed:' || v_tag || ']';

  DELETE FROM sales s
  WHERE s.notes LIKE v_prefix || ' sale %';
  GET DIAGNOSTICS v_deleted_sales = ROW_COUNT;

  DELETE FROM cash_sessions cs
  WHERE cs.notes LIKE v_prefix || ' session %'
    AND NOT EXISTS (
      SELECT 1
      FROM sales s
      WHERE s.cash_session_id = cs.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM expenses e
      WHERE e.cash_session_id = cs.id
    );
  GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;

  RETURN QUERY
  SELECT v_deleted_sales, v_deleted_sessions;
END;
$$ LANGUAGE plpgsql;
