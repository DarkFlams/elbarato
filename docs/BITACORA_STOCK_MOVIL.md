# Bitacora Viva - Stock Movil QR

Ultima actualizacion: 2026-03-20
Responsable actual: Codex + Miguel

## 1. Proposito de este archivo

Este documento existe para no perder contexto entre sesiones.
Antes de continuar desarrollo de stock movil, se debe leer:

1. `docs/PLAN_STOCK_MOVIL_QR.md`
2. `docs/BITACORA_STOCK_MOVIL.md` (este archivo)

Regla:
- Si se cambia alcance, seguridad, flujo o datos, se actualiza este archivo el mismo dia.

## 2. Decisiones congeladas

- El modulo movil sera solo para gestion de stock.
- Habra control de concurrencia en ajustes de conteo.
- Se elimina la estrategia offline para estas operaciones.
- Si no hay internet, no se guarda nada: se reintenta luego.
- "Todos" se muestra como "Medias".
- En gastos:
  - Individual: Medias visible.
  - Compartido: Medias excluida.

## 3. Resultado funcional esperado

### 3.1 Movil (web app)

- Login rapido por QR o codigo corto.
- Sesion temporal con expiracion.
- Escaneo de prenda y ajuste por conteo real.
- Auditoria por bloques por socia.

### 3.2 Desktop

- Generar QR/codigo para operadores.
- Ver campana de ajustes de stock.
- Revisar cambios (quien, cuanto, cuando, por que).

## 4. Estado actual (hoy)

### 4.1 Planificacion

- [x] Plan maestro de implementacion creado: `PLAN_STOCK_MOVIL_QR.md`.
- [x] Alcance actualizado: sin offline para esta iniciativa.

### 4.2 Base de negocio ya aterrizada

- [x] Renombre funcional de "Todos" a "Medias" en UI.
- [x] Gasto compartido excluye "Medias".
- [x] Gasto individual permite "Medias".
- [x] Regla local (Tauri) para bloquear partner no elegible en gasto compartido.
- [x] Migraciones SQL preparadas para reforzar la regla en Supabase.

### 4.3 Pendiente critico de esta iniciativa

- [x] Migraciones DB para sesiones moviles QR.
- [x] RPC de ajuste por conteo con `stock_revision`.
- [ ] UI movil de ajuste por conteo.
- [ ] Panel desktop de aprobacion/revision.
- [ ] Desactivar menu y flujos offline actuales.

## 5. Riesgos abiertos

- Riesgo: ajuste concurrente pisa stock.
  - Mitigacion definida: `expected_revision` + conflicto controlado.

- Riesgo: operador movil ve datos sensibles.
  - Mitigacion definida: scope `stock_only` y RLS estricta.

- Riesgo: red inestable en local.
  - Mitigacion definida: bloquear guardado sin internet con mensaje claro.

## 6. Siguiente bloque de implementacion (orden exacto)

1. Crear migraciones Supabase:
   - `mobile_access_codes`
   - `mobile_sessions`
   - `stock_adjustments`
   - `stock_audit_rounds`
   - `stock_audit_scans`
   - `products.stock_revision`
2. Implementar RPC `apply_stock_count_adjustment`.
3. Integrar pantalla movil "Sincronizar Realidad".
4. Integrar campana desktop para revisar ajustes.
5. Remover/ocultar offline en UI y escritura.

## 7. Regla de bitacora por sesion

En cada sesion de trabajo, agregar un bloque nuevo en esta seccion:

```md
### YYYY-MM-DD HH:mm
- Se hizo:
- Quedo pendiente:
- Riesgo detectado:
- Siguiente paso:
```

### 2026-03-20 00:15
- Se hizo: se congelo alcance de stock movil con concurrencia y sin offline.
- Se hizo: se creo plan principal `PLAN_STOCK_MOVIL_QR.md`.
- Se hizo: se creo esta bitacora viva.
- Quedo pendiente: empezar migraciones de DB (Fase 1).
- Siguiente paso: generar SQL de tablas y politicas RLS para sesion movil.

### 2026-03-20 15:35
- Se hizo: base SQL de Fase 1 implementada en:
  - `supabase/migration_stock_mobile_phase1.sql`
  - `supabase/schema_patch_existing.sql`
  - `supabase/schema.sql`
- Se hizo: agregado `products.stock_revision` y restricciones/indices asociados.
- Se hizo: creadas tablas `mobile_access_codes`, `mobile_sessions`, `stock_adjustments`, `stock_audit_rounds`, `stock_audit_scans`.
- Se hizo: RLS y policies `auth_all` para las tablas nuevas.
- Se hizo: RPC nuevos en `supabase/functions.sql`:
  - `issue_mobile_access_code`
  - `consume_mobile_access_code`
  - `touch_mobile_session`
  - `revoke_mobile_session`
  - `apply_stock_count_adjustment` (con conflicto por `expected_revision`).
- Se hizo: funciones de stock existentes ahora incrementan `stock_revision` para mantener concurrencia consistente.
- Quedo pendiente: integrar UI desktop (emitir QR y listar sesiones activas) y UI movil (consumir codigo + ajustar conteo).
- Riesgo detectado: si se ejecuta `functions.sql` antes de migrar tablas/columna, fallaran funciones nuevas.
- Siguiente paso: crear capa TS para usar los RPC nuevos desde desktop/movil (Fase 1 frontend).

### 2026-03-20 16:25
- Se hizo: capa frontend `src/lib/stock-mobile.ts` para RPC y consultas de:
  - emision/consumo de codigo QR;
  - heartbeat/revocacion de sesion;
  - ajuste por conteo con concurrencia;
  - listado de sesiones activas y ajustes recientes.
- Se hizo: nueva pantalla desktop `src/app/(dashboard)/stock-movil/page.tsx`:
  - genera acceso por TTL (30m/1h/4h);
  - muestra codigo manual + QR + link movil;
  - lista sesiones activas y permite revocar;
  - muestra ajustes recientes de stock.
- Se hizo: nueva pantalla movil publica `src/app/movil/stock/page.tsx`:
  - login por codigo/token sin password de owner;
  - busqueda por barcode/SKU;
  - ajuste por conteo fisico;
  - manejo de conflicto por revision en UI;
  - heartbeat periodico de sesion y expiracion local.
- Se hizo: menu de dashboard ahora incluye entrada `Stock Movil`.
- Se hizo: middleware permite acceso anonimo a `/movil/stock`.
- Validacion: eslint OK en archivos nuevos/modificados de este bloque.
- Quedo pendiente: aplicar SQL en Supabase y probar flujo extremo-a-extremo con telefono real.
- Siguiente paso: agregar Auditoria por bloques (Fase 4) y panel de revision/aprobacion (Fase 3).

### 2026-03-20 17:20
- Se hizo: separacion explicita Web vs Desktop para no mezclar producto de caja con herramientas moviles.
- Se hizo: en `middleware` se redirige cualquier acceso web normal a `/movil/stock`; el dashboard completo queda solo para runtime Tauri.
- Se hizo: `src/app/page.tsx` ahora redirige automaticamente:
  - Tauri -> `/caja`
  - Web -> `/movil/stock`
- Validacion: eslint OK en `src/lib/supabase/middleware.ts` y `src/app/page.tsx`.
- Quedo pendiente: continuar solo con funcionalidades de herramienta movil web.
- Siguiente paso: agregar Auditoria por bloques en `stock movil` sin tocar flujo desktop.

## 8. Checklist de continuidad rapida

Antes de codificar:
- [ ] Leer `PLAN_STOCK_MOVIL_QR.md`.
- [ ] Leer ultima entrada de esta bitacora.
- [ ] Confirmar que no se reintrodujo offline por error.

Antes de cerrar sesion:
- [ ] Registrar lo hecho en esta bitacora.
- [ ] Registrar pendientes reales (no genericos).
- [ ] Dejar el siguiente paso concreto en 1 linea.
