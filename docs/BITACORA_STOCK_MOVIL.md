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

- [ ] Migraciones DB para sesiones moviles QR.
- [ ] RPC de ajuste por conteo con `stock_revision`.
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

## 8. Checklist de continuidad rapida

Antes de codificar:
- [ ] Leer `PLAN_STOCK_MOVIL_QR.md`.
- [ ] Leer ultima entrada de esta bitacora.
- [ ] Confirmar que no se reintrodujo offline por error.

Antes de cerrar sesion:
- [ ] Registrar lo hecho en esta bitacora.
- [ ] Registrar pendientes reales (no genericos).
- [ ] Dejar el siguiente paso concreto en 1 linea.
