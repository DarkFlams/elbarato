-- ============================================
-- SEED DEMO EXPENSES (SOLO PRUEBAS)
-- ============================================
-- Crea gastos demo individuales y compartidos sin tocar inventario.
-- Si ya usaste seed_demo_sales.sql con el mismo tag, reutiliza esas
-- sesiones de caja demo por dia. Si no existen, las crea.
--
-- Uso sugerido:
--   SELECT * FROM seed_demo_expenses_range('2026-03-01', '2026-03-31', 30, 40, 'MARZO-2026-DEMO');
--
-- Limpieza:
--   SELECT * FROM cleanup_seed_demo_expenses('MARZO-2026-DEMO');

DROP FUNCTION IF EXISTS seed_demo_expenses_range(DATE, DATE, INT, INT, TEXT);
DROP FUNCTION IF EXISTS cleanup_seed_demo_expenses(TEXT);

CREATE OR REPLACE FUNCTION seed_demo_expenses_range(
  p_from_date DATE,
  p_to_date DATE,
  p_min_daily_total NUMERIC(10,2) DEFAULT 30,
  p_max_daily_total NUMERIC(10,2) DEFAULT 40,
  p_tag TEXT DEFAULT 'MARZO-2026-DEMO'
)
RETURNS TABLE (
  days_seeded INT,
  sessions_created INT,
  expenses_created INT,
  allocations_created INT,
  seeded_total NUMERIC(12,2)
) AS $$
DECLARE
  v_day DATE;
  v_tag TEXT;
  v_prefix TEXT;
  v_session_id UUID;
  v_expense_id UUID;
  v_expense_ts TIMESTAMPTZ;
  v_scope expense_scope;
  v_amount NUMERIC(10,2);
  v_day_target NUMERIC(10,2);
  v_day_total NUMERIC(10,2);
  v_remaining NUMERIC(10,2);
  v_description TEXT;
  v_idempotency_key TEXT;
  v_eligible_partner_count INT;
  v_partner_id UUID;
  v_partner_ids UUID[];
  v_partner_pick_count INT;
  v_share NUMERIC(10,2);
  v_remainder NUMERIC(10,2);
  v_days_seeded INT := 0;
  v_sessions_created INT := 0;
  v_expenses_created INT := 0;
  v_allocations_created INT := 0;
  v_seeded_total NUMERIC(12,2) := 0;
  v_descriptions TEXT[] := ARRAY[
    'moto',
    'flete',
    'almuerzo',
    'fundas',
    'insumos',
    'recarga',
    'limpieza',
    'transporte',
    'material de empaque',
    'caja chica'
  ];
BEGIN
  v_tag := COALESCE(NULLIF(trim(p_tag), ''), 'MARZO-2026-DEMO');
  v_prefix := '[seed:' || v_tag || ']';

  IF p_from_date IS NULL OR p_to_date IS NULL THEN
    RAISE EXCEPTION 'Debes indicar fecha inicial y fecha final';
  END IF;

  IF p_to_date < p_from_date THEN
    RAISE EXCEPTION 'La fecha final no puede ser menor a la inicial';
  END IF;

  IF COALESCE(p_min_daily_total, 0) <= 0 OR COALESCE(p_max_daily_total, 0) <= 0 THEN
    RAISE EXCEPTION 'El total diario debe ser mayor a cero';
  END IF;

  IF p_min_daily_total > p_max_daily_total THEN
    RAISE EXCEPTION 'El total minimo diario no puede ser mayor que el maximo diario';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM expenses e
    WHERE e.idempotency_key LIKE 'seed-expense-' || v_tag || '-%'
  ) THEN
    RAISE EXCEPTION 'Ya existen gastos demo para el tag %', v_tag;
  END IF;

  SELECT COUNT(*)::INT
  INTO v_eligible_partner_count
  FROM partners p
  WHERE p.is_expense_eligible = true;

  IF v_eligible_partner_count = 0 THEN
    RAISE EXCEPTION 'No hay socias elegibles para generar gastos demo';
  END IF;

  v_day := p_from_date;

  WHILE v_day <= p_to_date LOOP
    v_days_seeded := v_days_seeded + 1;

    SELECT cs.id
    INTO v_session_id
    FROM cash_sessions cs
    WHERE cs.notes = v_prefix || ' session ' || to_char(v_day, 'YYYY-MM-DD')
    LIMIT 1;

    IF NOT FOUND THEN
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
    END IF;

    v_day_target := ROUND((p_min_daily_total + random() * (p_max_daily_total - p_min_daily_total))::NUMERIC, 2);
    v_day_total := 0;

    FOR i IN 1..50 LOOP
      EXIT WHEN v_day_total >= v_day_target;

      v_expense_ts :=
        make_timestamptz(
          EXTRACT(YEAR FROM v_day)::INT,
          EXTRACT(MONTH FROM v_day)::INT,
          EXTRACT(DAY FROM v_day)::INT,
          10,
          0,
          0,
          'America/Bogota'
        )
        + make_interval(secs => floor(random() * 28800)::INT);

      v_remaining := ROUND(v_day_target - v_day_total, 2);
      IF v_remaining < 2 THEN
        IF v_day_total < p_min_daily_total THEN
          v_amount := 2;
        ELSE
          EXIT;
        END IF;
      ELSIF v_remaining BETWEEN 2 AND 5 THEN
        v_amount := v_remaining;
      ELSE
        v_amount := ROUND((2 + random() * 3)::NUMERIC, 2);
      END IF;

      v_description := v_descriptions[1 + floor(random() * array_length(v_descriptions, 1))::INT];
      v_scope := CASE
        WHEN v_eligible_partner_count = 1 THEN 'individual'::expense_scope
        WHEN random() < 0.55 THEN 'shared'::expense_scope
        ELSE 'individual'::expense_scope
      END;

      v_idempotency_key := 'seed-expense-' || v_tag || '-' || to_char(v_day, 'YYYYMMDD') || '-' || LPAD(i::TEXT, 2, '0');

      INSERT INTO expenses (
        cash_session_id,
        amount,
        description,
        scope,
        idempotency_key,
        registered_by,
        created_at,
        synced
      )
      VALUES (
        v_session_id,
        v_amount,
        v_description,
        v_scope,
        v_idempotency_key,
        NULL,
        v_expense_ts,
        true
      )
      RETURNING id INTO v_expense_id;

      IF v_scope = 'individual' THEN
        SELECT p.id
        INTO v_partner_id
        FROM partners p
        WHERE p.is_expense_eligible = true
        ORDER BY random()
        LIMIT 1;

        INSERT INTO expense_allocations (
          expense_id,
          partner_id,
          amount
        )
        VALUES (
          v_expense_id,
          v_partner_id,
          v_amount
        );

        v_allocations_created := v_allocations_created + 1;
      ELSE
        v_partner_pick_count := CASE
          WHEN v_eligible_partner_count <= 2 THEN v_eligible_partner_count
          WHEN random() < 0.65 THEN 2
          ELSE 3
        END;

        SELECT ARRAY_AGG(q.id)
        INTO v_partner_ids
        FROM (
          SELECT p.id
          FROM partners p
          WHERE p.is_expense_eligible = true
          ORDER BY random()
          LIMIT v_partner_pick_count
        ) q;

        v_share := ROUND(v_amount / array_length(v_partner_ids, 1), 2);
        v_remainder := ROUND(v_amount - (v_share * array_length(v_partner_ids, 1)), 2);

        FOR idx IN 1..array_length(v_partner_ids, 1) LOOP
          INSERT INTO expense_allocations (
            expense_id,
            partner_id,
            amount
          )
          VALUES (
            v_expense_id,
            v_partner_ids[idx],
            CASE
              WHEN idx = 1 THEN ROUND(v_share + v_remainder, 2)
              ELSE v_share
            END
          );

          v_allocations_created := v_allocations_created + 1;
        END LOOP;
      END IF;

      v_expenses_created := v_expenses_created + 1;
      v_day_total := ROUND(v_day_total + v_amount, 2);
      v_seeded_total := ROUND(v_seeded_total + v_amount, 2);
    END LOOP;

    v_day := v_day + 1;
  END LOOP;

  RETURN QUERY
  SELECT
    v_days_seeded,
    v_sessions_created,
    v_expenses_created,
    v_allocations_created,
    v_seeded_total;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_seed_demo_expenses(
  p_tag TEXT DEFAULT 'MARZO-2026-DEMO'
)
RETURNS TABLE (
  deleted_expenses INT,
  deleted_allocations INT,
  deleted_sessions INT
) AS $$
DECLARE
  v_tag TEXT;
  v_allocations INT := 0;
  v_expenses INT := 0;
  v_sessions INT := 0;
BEGIN
  v_tag := COALESCE(NULLIF(trim(p_tag), ''), 'MARZO-2026-DEMO');

  SELECT COUNT(*)::INT
  INTO v_allocations
  FROM expense_allocations ea
  JOIN expenses e ON e.id = ea.expense_id
  WHERE e.idempotency_key LIKE 'seed-expense-' || v_tag || '-%';

  DELETE FROM expenses e
  WHERE e.idempotency_key LIKE 'seed-expense-' || v_tag || '-%';
  GET DIAGNOSTICS v_expenses = ROW_COUNT;

  DELETE FROM cash_sessions cs
  WHERE cs.notes = '[seed:' || v_tag || '] session ' || to_char(cs.opened_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD')
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
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  RETURN QUERY
  SELECT v_expenses, v_allocations, v_sessions;
END;
$$ LANGUAGE plpgsql;
