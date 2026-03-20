-- ============================================================
-- Migration: "Todos" -> "Medias" + reglas de gastos
-- Ejecutar en Supabase SQL Editor (base existente)
-- ============================================================
-- Objetivo:
-- - Renombrar el partner "todos" a "Medias" en display_name.
-- - Permitir "Medias" en gasto individual.
-- - Bloquear "Medias" en gasto compartido.

BEGIN;

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS is_expense_eligible BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE partners
SET
  display_name = 'Medias',
  is_expense_eligible = FALSE
WHERE name = 'todos';

CREATE OR REPLACE FUNCTION check_expense_partner_eligible()
RETURNS TRIGGER AS $$
DECLARE
  v_scope expense_scope;
  v_is_eligible BOOLEAN;
BEGIN
  SELECT scope
  INTO v_scope
  FROM expenses
  WHERE id = NEW.expense_id;

  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'No existe el gasto asociado para la asignacion: %', NEW.expense_id;
  END IF;

  SELECT is_expense_eligible
  INTO v_is_eligible
  FROM partners
  WHERE id = NEW.partner_id;

  IF v_scope = 'shared' AND COALESCE(v_is_eligible, FALSE) = FALSE THEN
    RAISE EXCEPTION 'Partner "%" no es elegible para gastos compartidos.', NEW.partner_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expense_allocation_partner_check ON expense_allocations;

CREATE TRIGGER trg_expense_allocation_partner_check
  BEFORE INSERT OR UPDATE ON expense_allocations
  FOR EACH ROW
  EXECUTE FUNCTION check_expense_partner_eligible();

COMMIT;

-- Verificacion
SELECT name, display_name, is_expense_eligible
FROM partners
ORDER BY name;
