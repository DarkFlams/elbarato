# Plan De Implementacion - Stock Movil QR (Sin Offline)

Ultima actualizacion: 2026-03-20

Bitacora viva obligatoria de este modulo:
- `docs/BITACORA_STOCK_MOVIL.md`

## 1. Decision De Producto (Congelada)

- Se implementa modulo movil para gestion de stock.
- Se agrega control de concurrencia obligatorio en ajustes de stock.
- Se descontinua modo offline operativo para ventas, gastos e inventario.
- Si no hay internet, no se registran movimientos. El operador intenta luego.

## 2. Objetivo Principal

Eliminar errores de inventario fisico con un flujo movil rapido:

- entrada temporal por QR/codigo sin password;
- ajuste por conteo real (stock fisico manda);
- auditoria por bloques para detectar faltantes;
- supervision desde desktop con campana de ajustes.

## 3. Alcance

- Web app movil enfocada solo en stock.
- Desktop con panel de revision de ajustes.
- Seguridad por sesiones temporales.
- Concurrencia robusta para evitar pisado de stock.
- Sin reportes financieros en movil.
- Sin tablas gigantes en movil.

## 4. No Alcance (Por Ahora)

- No modo offline en movil ni desktop.
- No busqueda por voz en esta primera entrega.
- No cambios contables mayores fuera de stock.

## 5. Arquitectura Objetivo

### 5.1 Frontend

- Desktop (Tauri): emite QR, revisa ajustes, aprueba/revierte.
- Movil (web): escanear, contar, auditar, buscar producto.

### 5.2 Backend

- Supabase como fuente online unica para escrituras.
- RPC transaccional para ajuste por conteo con concurrencia.
- RLS por rol de sesion movil (`stock_operator`).

### 5.3 Regla De Disponibilidad

- Si `navigator.onLine === false` o falla request de salud:
  - deshabilitar botones de guardar.
  - mostrar mensaje claro: `Sin internet. Reintenta cuando vuelva la red.`
  - no encolar nada local.

## 6. Modelo De Datos (Nuevas Tablas Y Campos)

## 6.1 Tabla `mobile_access_codes`

- `id uuid pk`
- `code text unique` (codigo manual, ej: XJ9-K2L)
- `qr_token text unique`
- `issued_by uuid`
- `expires_at timestamptz`
- `consumed_at timestamptz null`
- `revoked_at timestamptz null`
- `created_at timestamptz default now()`

## 6.2 Tabla `mobile_sessions`

- `id uuid pk`
- `access_code_id uuid fk`
- `operator_name text`
- `scope text` (`stock_only`)
- `expires_at timestamptz`
- `last_seen_at timestamptz`
- `revoked_at timestamptz null`
- `created_at timestamptz default now()`

## 6.3 Campo en `products`

- `stock_revision bigint not null default 1`

Uso:
- sube +1 en cada cambio de stock;
- se usa como candado de concurrencia optimista.

## 6.4 Tabla `stock_adjustments`

- `id uuid pk`
- `product_id uuid fk`
- `performed_by_session_id uuid fk`
- `source text` (`mobile_count`, `desktop_manual`, `audit_round`)
- `reason text` (`physical_count`)
- `stock_before int`
- `stock_counted int`
- `delta int`
- `stock_revision_before bigint`
- `stock_revision_after bigint`
- `is_flagged boolean default false`
- `flag_reason text null`
- `review_status text` (`auto_applied`, `reviewed_ok`, `reverted`)
- `reviewed_by uuid null`
- `reviewed_at timestamptz null`
- `created_at timestamptz default now()`

## 6.5 Auditoria por bloques

### `stock_audit_rounds`
- `id uuid pk`
- `partner_id uuid fk`
- `started_by_session_id uuid fk`
- `started_at timestamptz`
- `closed_at timestamptz null`
- `status text` (`open`, `closed`)

### `stock_audit_scans`
- `id uuid pk`
- `round_id uuid fk`
- `product_id uuid fk`
- `scanned_at timestamptz`

## 7. RPC Critico: Ajuste Por Conteo Con Concurrencia

Funcion propuesta: `apply_stock_count_adjustment(...)`

Inputs:
- `p_product_id`
- `p_counted_stock`
- `p_expected_revision`
- `p_reason`
- `p_source`
- `p_session_id`

Flujo transaccional:
1. `SELECT ... FOR UPDATE` del producto.
2. Validar que `stock_revision == p_expected_revision`.
3. Si no coincide: devolver `conflict` + estado actual (`stock`, `revision`).
4. Calcular `delta = p_counted_stock - stock_actual`.
5. Actualizar `products.stock = p_counted_stock`, `stock_revision = stock_revision + 1`.
6. Insertar `inventory_movements`.
7. Insertar `stock_adjustments`.
8. Retornar resultado final.

Salida:
- `ok/conflict`
- `stock_before`, `stock_after`, `delta`
- `new_revision`

## 8. Reglas De Negocio De Concurrencia

- Ningun ajuste se aplica sin `expected_revision`.
- El cliente movil siempre refresca revision despues de conflicto.
- Si hay conflicto, el operador vuelve a contar y confirma.
- No se hace retry automatico silencioso en ajustes de stock.

## 9. UX Movil

## 9.1 Login QR Express

- Vista `Entrar con QR`.
- Fallback `codigo manual`.
- Session TTL configurable: 30m, 1h, 4h.
- Al expirar, cierre de sesion forzado.

## 9.2 Sincronizar Realidad

Paso a paso:
1. Escanear prenda.
2. Mostrar `Sistema dice: N`.
3. Ingresar `Conteo fisico: M`.
4. Confirmar ajuste.
5. Mostrar resultado y nuevo stock.

## 9.3 Auditoria Por Bloques

1. Elegir socia.
2. Escaneo continuo.
3. Cerrar ronda.
4. Mostrar:
   - escaneados;
   - faltantes;
   - productos repetidos.

## 10. UX Desktop

- Menu nuevo: `Ajustes de Stock`.
- Campana con contador de ajustes nuevos.
- Tabla de eventos:
  - operador;
  - producto;
  - antes/despues;
  - delta;
  - hora;
  - motivo.
- Acciones:
  - marcar `revisado ok`;
  - `revertir` (crea movimiento inverso auditado).

## 11. Seguridad

- Tokens QR de un solo uso.
- Sesion movil con expiracion dura.
- Revocacion desde desktop.
- Scope movil solo stock.
- RLS sin acceso a ventas, gastos, reportes financieros.

## 12. Plan De Ejecucion (Fases)

## Fase 1 - Base DB y seguridad QR

- Crear migraciones de tablas `mobile_access_codes`, `mobile_sessions`, `stock_adjustments`, `stock_audit_*`.
- Agregar `products.stock_revision`.
- Crear politicas RLS para sesion movil.
- Crear endpoints/API para emitir y consumir QR/codigo.

Criterio de salida:
- se puede abrir sesion movil temporal;
- expira automaticamente;
- no accede a finanzas.

## Fase 2 - Ajuste por conteo con concurrencia

- Implementar RPC `apply_stock_count_adjustment`.
- Integrar en pantalla movil de ajuste.
- Manejo de conflicto visual.

Criterio de salida:
- dos usuarios ajustando mismo SKU no pisan stock;
- uno recibe conflicto y reintenta con datos nuevos.

## Fase 3 - Panel desktop de revision

- Campana + listado de ajustes.
- Estados de revision.
- Accion de revertir con trazabilidad.

Criterio de salida:
- dueño ve todos los ajustes;
- puede revisar y revertir sin romper inventario.

## Fase 4 - Auditoria por bloques

- Crear flujo de ronda por socia.
- Resultado de faltantes y escaneados.

Criterio de salida:
- ronda cerrada devuelve faltantes correctos por socio/bloque.

## Fase 5 - Apagado de offline

- Ocultar/remover menu `Offline`.
- Quitar banner `pendiente por sincronizar`.
- Desactivar cola local para escrituras.
- Forzar flujo online requerido en botones de guardar.
- Mensajes claros de red caida.

Criterio de salida:
- no se crean pendientes locales;
- sin internet no se registra y el usuario entiende por que.

## 13. Checklist De QA

- QR valido entra; QR vencido no entra.
- Codigo manual valida igual que QR.
- Ajuste normal cambia stock exacto.
- Ajuste concurrente produce conflicto controlado.
- Shared flows de gastos no se ven en movil.
- Sin internet: no guarda, no encola, mensaje claro.
- Campana desktop refleja cada ajuste aplicado.
- Reversion crea movimiento inverso y deja rastro.

## 14. Riesgos y mitigaciones

- Riesgo: token QR filtrado.
  Mitigacion: un solo uso + expiracion corta + revocacion.

- Riesgo: operador ajusta mal por apuro.
  Mitigacion: mostrar antes/despues/delta y confirmar.

- Riesgo: conflictos frecuentes en horas pico.
  Mitigacion: mensaje de conflicto simple y refresco inmediato de stock/revision.

- Riesgo: quitar offline y frustrar operacion si cae red.
  Mitigacion: aviso inmediato y procedimiento operativo: registrar en hoja temporal y cargar al volver red.

## 15. Orden Tecnico Recomendado

1. Fase 1 (DB + QR).
2. Fase 2 (conteo + concurrencia).
3. Fase 3 (campana y revision).
4. Fase 5 (apagado offline).
5. Fase 4 (auditoria por bloques).

Razon:
- primero seguridad y consistencia de stock;
- luego simplificacion operativa;
- auditoria avanzada al final.
