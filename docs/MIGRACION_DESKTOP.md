# Migracion a Desktop con Tauri (Local-First Total)

Documento maestro para convertir el POS actual en un programa de escritorio donde la PC sea la fuente primaria de operacion y Supabase quede como segundo plano de sincronizacion y respaldo.

Ultima actualizacion: 2026-03-19

## 1. Objetivo real

La meta ya no es solo "meter la web en un exe".

La meta es esta:

- el programa abre y responde como software de PC;
- toda la operacion critica vive localmente en la maquina;
- internet no bloquea caja, gastos ni inventario;
- Supabase sigue existiendo, pero como nube secundaria para sync, respaldo y acceso remoto.

Regla principal:

- todo lo que hoy se crea o modifica en Supabase tambien debe existir primero en la PC;
- primero se guarda local;
- despues se sincroniza a Supabase.

## 2. Fuente de verdad

Nueva regla de arquitectura:

- fuente primaria de operacion: `SQLite local en la PC`;
- fuente secundaria: `Supabase`;
- sincronizacion: `worker en segundo plano`;
- UI: lee primero desde local.

Eso aplica a todo lo operativo:

- partners;
- products;
- cash_sessions;
- sales;
- sale_items;
- expenses;
- expense_allocations;
- inventory_movements;
- configuracion local;
- cola de sync;
- journal de sync.

## 3. Alcance no negociable

Inventario tambien entra completo.

No solo se guarda local "lo minimo". Se guarda local todo lo necesario para operar rapido y sin internet:

- catalogo de productos;
- barcode;
- nombre;
- stock;
- minimo;
- socia;
- estado activo/inactivo;
- precios usados por caja;
- movimientos de inventario;
- ajustes de stock;
- altas y ediciones de productos;
- migraciones/importaciones de inventario.

Si inventario no vive localmente, el exe seguira sintiendose como web.

## 4. Como debe funcionar

### Lecturas

Todas las pantallas operativas leen desde SQLite:

- caja;
- inventario;
- gastos;
- cierres;
- pantallas de seleccion, busqueda y escaneo;
- reportes operativos rapidos.

### Escrituras

Toda accion del usuario escribe primero en SQLite:

- registrar venta;
- registrar gasto;
- crear producto;
- editar producto;
- ajustar stock;
- abrir caja;
- cerrar caja;
- registrar movimiento.

Luego esa accion se mete en `sync_queue`.

### Sincronizacion

Un worker en segundo plano:

- detecta conectividad;
- empuja pendientes a Supabase;
- trae cambios remotos si hacen falta;
- marca como sincronizado;
- deja trazabilidad si falla.

## 5. Resultado esperado

Con internet:

- la app opera local;
- sincroniza sin bloquear;
- Supabase se mantiene al dia.

Sin internet:

- la app sigue operando normal;
- no se queda cargando;
- los datos quedan en la PC;
- al volver internet, sincroniza.

## 6. Arquitectura objetivo

### Shell

- `Tauri v2` como ejecutable de escritorio.
- `WebView2` para la UI.
- `Rust commands` para acceso nativo.

### Datos

- `SQLite` como base local principal.
- `Supabase` como backend remoto.

### Capas

- frontend React/Next: interfaz y flujos.
- capa local: consultas y escrituras a SQLite.
- sync engine: cola, journal, retries, conflictos.
- capa remota: push/pull con Supabase.

## 7. Tablas locales necesarias

La base local debe espejar el dominio real:

- `partners`
- `products`
- `cash_sessions`
- `sales`
- `sale_items`
- `expenses`
- `expense_allocations`
- `inventory_movements`
- `sync_queue`
- `sync_journal`
- `app_settings`

Columnas operativas adicionales recomendadas:

- `local_id`
- `remote_id`
- `dirty`
- `sync_status`
- `sync_attempts`
- `last_sync_error`
- `updated_at`
- `synced_at`

## 8. Reglas por modulo

### Ventas

- se guardan primero en local;
- `sale_items` tambien se guardan local;
- el stock local se descuenta en la misma transaccion;
- se registra evento de sync con `idempotency_key`.

### Gastos

- se guardan primero en local;
- asignaciones por socia se guardan localmente;
- se sincronizan despues con la misma llave de idempotencia.

### Inventario

- alta de producto local primero;
- edicion local primero;
- ajuste de stock local primero;
- movimiento de inventario local primero;
- lectura de stock y busqueda siempre local.

### Caja

- apertura local primero;
- cierre local primero;
- cuadre visible aunque no haya internet.

### Reportes operativos

- lectura local para rapidez;
- luego se puede contrastar con Supabase si hace falta.

## 9. Reglas de sincronizacion

### Push local -> Supabase

- usar `idempotency_key` en toda operacion critica;
- enviar por lotes pequenos;
- no bloquear la UI;
- confirmar y marcar `synced_at` solo cuando Supabase responde OK.

### Pull Supabase -> local

- traer cambios por `updated_at` o watermark;
- actualizar tablas locales no criticas;
- no sobreescribir ciegamente operaciones cerradas.

### Conflictos

- ventas: no se reescriben, solo se deduplican.
- gastos: no se reescriben, solo se deduplican.
- inventario: resolver con movimiento compensatorio auditado, no pisando stock silenciosamente.
- productos: si hay conflicto de edicion, usar regla clara y dejar journal.

## 10. Riesgos reales

1. Duplicar ventas o gastos al reconectar.
2. Romper stock por conflictos entre local y remoto.
3. Lentitud si una pantalla sigue leyendo de Supabase.
4. Corrupcion local si no usamos transacciones.
5. Desfase entre PC y nube si no hay journal ni retries claros.

## 11. Mitigaciones obligatorias

1. `idempotency_key` en todas las escrituras criticas.
2. transacciones SQLite para ventas, gastos y ajustes.
3. `sync_queue` separada de las tablas de negocio.
4. `sync_journal` para auditoria.
5. panel visible de sincronizacion y errores.
6. backups locales automaticos.

## 12. Fases de ejecucion

## Fase A - Base local

Objetivo:

- crear SQLite y schema espejo.

Estado:

- En progreso.

Cambios concretos:

- crear capa Tauri/Rust para SQLite;
- definir tablas locales;
- preparar migraciones locales;
- guardar `app_settings`.

Salida:

- la app ya tiene base de datos propia en la PC.

## Fase B - Lectura local total

Objetivo:

- que la UI operativa lea desde local.

Cambios concretos:

- inventario carga desde SQLite;
- caja busca productos en SQLite;
- socios, sesion y configuracion salen de SQLite;
- cache inicial desde Supabase solo para hidratar.

Salida:

- la app abre rapido y no depende de red para mostrar datos.

## Fase C - Escritura local de ventas y gastos

Objetivo:

- que ventas y gastos se registren primero en PC.

Cambios concretos:

- registrar venta en SQLite + `sync_queue`;
- registrar gasto en SQLite + `sync_queue`;
- mantener idempotencia;
- no bloquear UI esperando Supabase.

Salida:

- caja y gastos ya operan offline de verdad.

## Fase D - Inventario local completo

Objetivo:

- que inventario sea completamente local-first.

Cambios concretos:

- crear/editar producto local;
- ajustes y movimientos locales;
- migracion de inventario local;
- busqueda y escaneo local.

Salida:

- inventario responde como programa de PC.

## Fase E - Sync engine

Objetivo:

- sincronizar sin bloquear y sin duplicar.

Cambios concretos:

- worker de sync;
- retries;
- push/pull incremental;
- journal de errores;
- estado visible de sync.

Salida:

- Supabase queda actualizado en segundo plano.

## Fase F - Cierre operativo

Objetivo:

- dejar el exe listo para caja real.

Cambios concretos:

- apertura/cierre local-first;
- impresion nativa;
- pruebas de jornada sin internet;
- pruebas de reconexion y conciliacion.

Salida:

- operacion diaria estable sin depender de red.

## 13. Orden de prioridad

1. Base SQLite.
2. Lectura local de catalogos e inventario.
3. Escritura local de ventas y gastos.
4. Inventario local completo.
5. Sync con Supabase.
6. Cierre de caja, reconciliacion e impresion fina.

## 14. Criterios de exito

- la app abre aunque no haya internet;
- inventario carga desde la PC;
- ventas se registran aunque no haya internet;
- gastos se registran aunque no haya internet;
- ajustes de inventario funcionan aunque no haya internet;
- al volver internet, Supabase se actualiza sin duplicados;
- el usuario no espera la nube para operar.

## 15. Decision final

El exe no debe ser "una web envuelta".

Debe ser esto:

- interfaz en Tauri;
- datos en PC;
- sync en segundo plano;
- Supabase como nube secundaria.

Ese es el camino correcto si quieres velocidad real, operacion estable y resistencia a caidas de internet.

## 16. Bitacora

### 2026-03-19 - Inicio real de Fase A

- Se integra `rusqlite` embebido dentro de Tauri para que el exe no dependa de una libreria externa en la PC destino.
- La app ahora crea automaticamente su base local en la carpeta local de la aplicacion de Windows.
- Se aplica schema inicial local para:
  - `app_settings`
  - `partners`
  - `products`
  - `cash_sessions`
  - `sales`
  - `sale_items`
  - `expenses`
  - `expense_allocations`
  - `inventory_movements`
  - `sync_queue`
  - `sync_journal`
- Se agrega comando Tauri `get_local_database_info` para inspeccionar ruta, tamano y version del schema local.
- Validacion tecnica completada con `cargo check`.

Siguiente paso:

- Fase B: empezar a hidratar y leer catalogos desde SQLite, empezando por `partners` y `products`.
