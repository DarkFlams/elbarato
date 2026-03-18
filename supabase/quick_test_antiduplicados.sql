-- ============================================
-- Quick test: anti-duplicados (ventas y gastos)
-- ============================================
-- Uso recomendado:
-- 1) En la app, registra una venta de prueba con NOTES = 'TEST_DUP_SALE_001'
--    y haz doble click rapido en "Registrar venta".
-- 2) En la app, registra un gasto de prueba con DESCRIPTION = 'TEST_DUP_EXP_001'
--    y haz doble click rapido en "Registrar gasto".
-- 3) Ejecuta este script y revisa los resultados esperados.

-- --------------------------------------------
-- A) Salud global de idempotencia
-- Esperado: 0 filas en ambas consultas
-- --------------------------------------------
SELECT idempotency_key, COUNT(*) AS times
FROM sales
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

SELECT idempotency_key, COUNT(*) AS times
FROM expenses
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

-- --------------------------------------------
-- B) Venta de prueba (ajusta el token si usaste otro)
-- Esperado: sale_count = 1
-- --------------------------------------------
SELECT COUNT(*) AS sale_count
FROM sales
WHERE notes = 'TEST_DUP_SALE_001';

-- Detalle de esa venta de prueba
SELECT id, created_at, total, payment_method, notes, idempotency_key
FROM sales
WHERE notes = 'TEST_DUP_SALE_001'
ORDER BY created_at DESC;

-- Verifica que la venta tenga items y movimientos (no duplicados por venta)
SELECT
  s.id AS sale_id,
  COUNT(DISTINCT si.id) AS sale_items_count,
  COUNT(DISTINCT im.id) AS inventory_movements_count
FROM sales s
LEFT JOIN sale_items si ON si.sale_id = s.id
LEFT JOIN inventory_movements im
  ON im.reference_id = s.id
  AND im.reason = 'sale'
WHERE s.notes = 'TEST_DUP_SALE_001'
GROUP BY s.id
ORDER BY s.id DESC;

-- --------------------------------------------
-- C) Gasto de prueba (ajusta el token si usaste otro)
-- Esperado: expense_count = 1
-- --------------------------------------------
SELECT COUNT(*) AS expense_count
FROM expenses
WHERE description = 'TEST_DUP_EXP_001';

-- Detalle de ese gasto de prueba
SELECT id, created_at, amount, scope, description, idempotency_key
FROM expenses
WHERE description = 'TEST_DUP_EXP_001'
ORDER BY created_at DESC;

-- Verifica asignaciones del gasto
SELECT
  e.id AS expense_id,
  COUNT(ea.id) AS allocations_count,
  SUM(ea.amount) AS allocations_total,
  e.amount AS expense_amount
FROM expenses e
LEFT JOIN expense_allocations ea ON ea.expense_id = e.id
WHERE e.description = 'TEST_DUP_EXP_001'
GROUP BY e.id, e.amount
ORDER BY e.id DESC;
