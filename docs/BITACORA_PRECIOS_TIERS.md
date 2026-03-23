# Bitacora Precios Tiers

Fecha base: 2026-03-23

## Objetivo

Agregar una lista de precios separada del inventario, usando los mismos productos existentes, con estos campos:

- `sale_price` como PVP normal
- `sale_price_x3`
- `sale_price_x6`
- `sale_price_x12`

Tambien permitir usar esos precios en caja y conservar el flujo actual de migracion de inventario.

## Criterios

- No borrar ni reemplazar la migracion vieja de inventario.
- Mantener compatibilidad con productos existentes.
- Soportar bases locales ya instaladas.
- Permitir importacion de precios desde `docs/Inventario/precios.xlsx`.
- Guardar el precio real usado en la venta y el tier seleccionado.

## Plan tecnico

1. Extender `products` en Supabase y SQLite con columnas nuevas de precios.
2. Extender tipos TS, sync local/remoto y RPC de productos.
3. Crear pantalla `Lista de precios` con edicion inline.
4. Integrar selector de tier en caja y soporte por item.
5. Ampliar importacion con modo de actualizacion de precios.
6. Verificar con typecheck y pruebas del flujo principal.

## Estado actual

- Hecho: schema Supabase + patch + SQLite local con `sale_price_x3`, `sale_price_x6`, `sale_price_x12`.
- Hecho: `sale_items.price_tier` en Supabase y SQLite.
- Hecho: tipos TS y sync desktop/offline para tiers.
- Hecho: ruta `/precios` con tabla inline para editar precios.
- Hecho: ruta `/precios/importar` para cargar `precios.xlsx`.
- Hecho: selector global de tier en caja y selector por linea en carrito.
- Hecho: ticket, venta local y sync remoto usando `price_override` como precio cobrado y `price_tier` como auditoria.
- Verificado: `npx tsc --noEmit`, `cargo check` en `src-tauri` y `npm run build`.

## Decisiones

- `sale_price` sigue siendo el precio normal para no romper compatibilidad.
- Los tiers `x3/x6/x12` se guardan como valores explicitos, no calculados.
- Si un tier no existe, se guarda como `NULL`.
- La migracion de precios sera aditiva y separada del importador viejo.
- El importador de precios no cambia nombre, barcode ni socia; solo precios y, opcionalmente, stock.
