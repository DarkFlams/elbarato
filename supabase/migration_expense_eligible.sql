-- ============================================================
-- Migración: Blindaje de Gastos — Partner Eligibility
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- CAPA 1: Columna is_expense_eligible
-- "Todos" no es una socia real, no debe participar en gastos.
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS is_expense_eligible BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE partners
  SET is_expense_eligible = FALSE
  WHERE name = 'todos';

-- CAPA 2: Trigger de seguridad en expense_allocations
-- Rechaza cualquier intento de crear una allocation para un partner
-- que no sea elegible para gastos, sin importar qué haga el frontend.
CREATE OR REPLACE FUNCTION check_expense_partner_eligible()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (SELECT is_expense_eligible FROM partners WHERE id = NEW.partner_id) THEN
    RAISE EXCEPTION 'Partner "%" no es elegible para asignación de gastos. Solo socias reales pueden recibir gastos.', NEW.partner_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Eliminar trigger previo si existe (idempotente)
DROP TRIGGER IF EXISTS trg_expense_allocation_partner_check ON expense_allocations;

CREATE TRIGGER trg_expense_allocation_partner_check
  BEFORE INSERT ON expense_allocations
  FOR EACH ROW
  EXECUTE FUNCTION check_expense_partner_eligible();

-- Verificación: listar partners y su elegibilidad
SELECT name, display_name, is_expense_eligible FROM partners ORDER BY name;
