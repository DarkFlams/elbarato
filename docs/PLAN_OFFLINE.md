# Plan Offline Operativo

Documento de ejecucion para implementar modo offline real sin perder continuidad.

Ultima actualizacion: 2026-03-18

## Objetivo

Permitir que caja y gastos sigan operando cuando no hay internet, sin duplicados contables al reconectar.

## Principios no negociables

- Nunca duplicar ventas ni gastos.
- Nunca dejar al cajero bloqueado "cargando" por caida de red.
- Mostrar estado claro: `Online`, `Offline`, `Pendiente de sincronizar`.
- Sincronizar automatico al volver internet.
- Mantener trazabilidad de lo que quedo pendiente y lo que ya sincronizo.

## Alcance por fases

## Fase 1 - Base tecnica (MVP robusto)

Estado: Completada.

- [x] Cola local persistente para operaciones criticas (`sales`, `expenses`).
- [x] Formato unico de operacion offline con `idempotency_key`.
- [x] Sincronizador secuencial con lock para evitar carreras.
- [x] Deteccion de errores de conectividad vs errores funcionales.
- [x] Indicador global de conectividad y pendientes.

## Fase 2 - Integracion de caja y gastos

Estado: Completada.

- [x] Venta: si falla por red, guardar pendiente y liberar flujo del cajero.
- [x] Gasto: mismo comportamiento, sin duplicados.
- [x] Mensajes claros en UI: "guardado offline, se sincronizara".
- [x] Bloqueo de doble envio local + idempotencia en backend.

## Fase 3 - Visibilidad y control operativo

Estado: En progreso.

- [x] Vista de operaciones pendientes/fallidas.
- [x] Reintento manual por operacion.
- [x] Cancelacion manual de pendientes invalidas.
- [ ] Telemetria basica (cantidad de pendientes, ultimo sync, errores).

## Fase 4 - Cobertura total de escritura

Estado: Pendiente.

- [ ] Apertura/cierre de caja offline.
- [ ] Ajustes de inventario offline.
- [ ] Reconciliacion de conflictos de stock tras reconexion.

## Riesgos y mitigaciones

- Riesgo: duplicados por reintentos.
  Mitigacion: `idempotency_key` en todas las operaciones que entren a cola.

- Riesgo: cajero sin feedback.
  Mitigacion: indicador persistente de estado + toasts de guardado offline.

- Riesgo: cola atascada por un error funcional.
  Mitigacion: marcar como `failed`, continuar con otras, exponer lista de errores.

## Checklist operativo de salida

- [ ] Desconectar internet y registrar 3 ventas + 3 gastos sin bloqueo.
- [ ] Reconectar internet y verificar sincronizacion completa automatica.
- [ ] Confirmar `0` duplicados por `idempotency_key`.
- [ ] Confirmar que montos y asignaciones coinciden en reportes.
- [ ] Confirmar que UI deja claro cuando hay pendientes.

## Bitacora

### 2026-03-18

- Se crea plan offline formal para ejecutar por fases sin perder contexto.
- Se define empezar por cola local + sincronizacion automatica + integracion en ventas/gastos.
- Se crea seccion `/offline` para operar cola local con retry individual/masivo y limpieza manual.
