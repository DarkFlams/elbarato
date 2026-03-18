-- ============================================
-- Reset seguro de inventario antes de importar INVEN.xlsx
-- Ejecutar en Supabase SQL Editor
-- ============================================
-- Objetivo:
-- - sacar de operacion el inventario actual cargado con codigos incorrectos;
-- - permitir una nueva importacion desde INVEN.xlsx sin duplicar por nombre;
-- - preservar historial operativo basico (ventas, gastos, sesiones).
--
-- Este reset NO elimina ventas, gastos ni sesiones de caja.
-- Lo que hace es:
-- - poner stock en 0 a todos los productos;
-- - desactivar todos los productos;
-- - borrar movimientos de inventario para arrancar limpio.
--
-- Despues de ejecutar esto:
-- - el modulo de inventario quedara sin productos activos;
-- - el importador podra crear o reactivar productos usando los barcodes reales;
-- - el historial de ventas previo seguira existiendo.

BEGIN;

UPDATE products
SET
  stock = 0,
  is_active = false,
  updated_at = now();

DELETE FROM inventory_movements;

COMMIT;

-- Verificacion rapida
SELECT
  COUNT(*) AS total_products,
  COUNT(*) FILTER (WHERE is_active) AS active_products,
  COALESCE(SUM(stock), 0) AS total_stock
FROM products;

SELECT COUNT(*) AS inventory_movements_after_reset
FROM inventory_movements;
