# Plan Maestro

Documento de contexto operativo para no perder continuidad entre sesiones.

Ultima actualizacion: 2026-03-17

## 1. Vision del producto

Construir un POS para un negocio familiar que no solo cobre ventas, sino que permita:

- separar resultados por socia;
- registrar gastos individuales y compartidos;
- reflejar esos gastos en reportes diarios, semanales, mensuales o por rango;
- controlar inventario con procesos simples y profesionales;
- abrir la puerta a un asistente que facilite carga, analisis y recomendaciones.

## 2. Estado actual del proyecto

### Base funcional ya visible en el repo

- POS con lectura por barcode y busqueda manual.
- Carrito de ventas con agrupacion por socia.
- Sesion de caja con apertura y cierre.
- Inventario con productos, stock, precio y duena.
- Gastos con reparto individual o compartido.
- Reportes por sesion de caja.
- Exportacion a Excel y PDF.
- PWA basica con `manifest` y `service worker`.
- Supabase como backend principal.

### Huecos identificados

- `README.md` estaba en plantilla y no documentaba el proyecto.
- No existe una bitacora persistente de decisiones y fases.
- El schema SQL cubre lo principal, pero todavia no hay endurecimiento de reglas de negocio.
- No se ven pruebas automaticas.
- No hay documentacion de despliegue, respaldo ni operacion diaria.
- La parte de asistente de inventario todavia es vision, no modulo implementado.

## 3. Arquitectura actual resumida

### Frontend

- Next.js App Router.
- Pantallas principales en `src/app/(dashboard)`.
- Estado local/global con hooks y Zustand.
- UI basada en componentes reutilizables.

### Backend

- Supabase para auth, datos y consultas.
- SQL manual en `supabase/schema.sql`.
- RPC inicial para movimientos de stock en `supabase/functions.sql`.

### Dominio principal

- `partners`: socias del negocio.
- `products`: productos y stock.
- `cash_sessions`: apertura y cierre.
- `sales` y `sale_items`: ventas y detalle.
- `expenses` y `expense_allocations`: gastos y reparto.
- `inventory_movements`: historial de stock.
- `v_cash_session_report`: vista de liquidacion por socia.

## 4. Fases propuestas

## Fase 0. Documentacion y estabilizacion

Objetivo: dejar una base comprensible y segura para iterar.

Estado:

- [x] Crear documento maestro de continuidad.
- [x] Reemplazar README generico por documentacion real.
- [ ] Mapear flujos faltantes y reglas de negocio criticas.
- [ ] Revisar encoding y textos con caracteres danados.
- [ ] Definir convencion de cambios y bitacora por sesion.

## Fase 1. POS y caja confiables

Objetivo: asegurar que vender y cerrar caja sea solido.

Entregables:

- validaciones de stock antes de vender;
- registro consistente de pagos;
- cierre de caja con cuadre claro;
- errores visibles y recuperables;
- manejo basico offline o degradacion controlada.

Estado actual:

- La base esta implementada.
- La venta ya se registro de forma atomica mediante RPC transaccional.
- La interfaz ya bloquea agregar o incrementar por encima del stock disponible.
- El flujo de cobro reduce interrupciones: no abre ticket automaticamente en cada venta.
- Sigue pendiente revisar mejor manejo offline y sincronizacion.

## Fase 2. Gastos y liquidacion por socia

Objetivo: convertir el modulo diferencial del proyecto en algo totalmente confiable.

Entregables:

- gastos con reglas claras de reparto;
- reportes por dia, semana, mes y rango;
- liquidacion por socia con neto final;
- exportes entendibles para operacion real.

Estado actual:

- Existe reparto por sesion.
- Falta agregacion historica avanzada y validacion contable.

## Fase 3. Inventario operativo

Objetivo: pasar de CRUD basico a gestion util para negocio real.

Entregables:

- entradas manuales rapidas;
- movimientos de inventario auditables;
- alertas de bajo stock;
- mejor soporte para etiquetas y codigos;
- importacion o carga asistida de productos.

Estado actual:

- CRUD base presente.
- Ya existe historial visible de movimientos de inventario en la UI.
- Ya se registran ajustes manuales y stock inicial desde el formulario.
- El guardado de producto y movimiento ahora usa RPC transaccional unica.
- El alta/edicion de inventario ya esta enfocada en ropa (tallas visibles y solo precio de venta en formulario).
- El formulario ahora usa tallas escritas (sin tipo de prenda ni notas).
- Altas y bajas ahora viven en una seccion separada para no saturar inventario.
- Ya existe pantalla de migracion por archivo para stock existente.
- Falta evolucionar analitica y flujos asistidos.

## Fase 4. Asistente de inventario

Objetivo: permitir que la duena cargue, consulte y mejore inventario con menos friccion.

Ideas concretas:

- chat para crear productos;
- captura guiada desde celular;
- sugerencias de reposicion;
- analisis de rotacion;
- recomendaciones por ventas y stock.

Estado actual:

- No se observan implementaciones de este modulo.

## Fase 5. Seguridad, datos y operacion

Objetivo: evitar que el sistema sea util pero fragil.

Entregables:

- politicas RLS revisadas con criterio real;
- permisos por rol si aplica;
- backups y restauracion;
- auditoria minima de acciones;
- guia de despliegue y mantenimiento.

Estado actual:

- Hay RLS abierta para usuarios autenticados.
- Eso sirve para arrancar, pero no es un modelo final de seguridad.
- Prioridad actual: fiabilidad operativa y calidad de registros antes que seguridad avanzada de estilo SaaS.

## Fase 6. Calidad y despliegue

Objetivo: que el sistema sea mantenible y desplegable sin improvisacion.

Entregables:

- pruebas criticas;
- checklist de release;
- documentacion de instalacion;
- monitoreo minimo;
- validacion en moviles reales.

## 5. Backlog priorizado

1. Corregir documentacion base y mantener este archivo vivo.
2. Extender reportes por rango de fechas.
3. Endurecer integridad de datos y validaciones SQL para evitar inconsistencias.
4. Mejorar seguridad y politicas de acceso en Supabase con enfoque pragmatica.
5. Disenar el modulo de asistente de inventario con alcance claro.

## 6. Riesgos y deuda tecnica

- El proyecto tiene muchos cambios locales sin confirmar; hay que trabajar con cuidado.
- Se observan textos con problemas de encoding.
- El `service worker` es basico y no conviene considerarlo solucion offline completa.
- El lint ya no muestra errores ni warnings.
- La documentacion tecnica todavia esta naciendo.

## 7. Regla de trabajo para proximas sesiones

Cada vez que se haga trabajo relevante:

1. actualizar el estado de la fase;
2. anotar decisiones importantes;
3. registrar archivos tocados;
4. dejar el siguiente paso concreto.

## 8. Bitacora

### 2026-03-17

Resumen:

- Se audito la estructura actual del proyecto.
- Se confirmo que el sistema ya tiene base funcional real en POS, gastos, inventario, cierre y reportes.
- Se detecto falta de documentacion persistente.
- Se creo este documento como referencia principal de continuidad.

### 2026-03-17 - Fase 1

Resumen:

- Se reviso el flujo de venta punta a punta.
- Se detecto que la venta se registraba desde cliente en varios pasos separados.
- Se reemplazo ese flujo por una RPC transaccional `register_sale`.
- La RPC ahora valida autenticacion, sesion abierta, stock suficiente y registra venta, items y movimientos en una sola operacion.
- Se adapto el carrito para usar la RPC nueva.
- Se corrigieron errores de lint en `use-barcode-scanner.ts` y `audio.ts`.
- Se agregaron validaciones preventivas de stock en scanner, buscador y carrito.
- Se limpio el resto de warnings de lint.

Archivos tocados:

- `src/components/pos/cart.tsx`
- `src/lib/supabase/client.ts`
- `src/hooks/use-barcode-scanner.ts`
- `src/lib/audio.ts`
- `supabase/functions.sql`

Riesgos pendientes:

- Falta exponer el historial de `inventory_movements` en una pantalla util.
- Falta ampliar reportes agregados mas alla del historial por sesion.

### 2026-03-17 - Fase 1 y reportes

Resumen:

- Se bloqueo la carga en carrito cuando un producto no tiene stock o ya alcanzo su maximo disponible.
- Se mostraron mensajes de stock disponible en la UI.
- Se agregaron filtros por rango de fechas en la pantalla de reportes historicos.
- Se agregaron atajos rapidos para hoy, 7 dias y 30 dias.
- El proyecto quedo con `npm run lint` limpio.

Archivos tocados:

- `src/types/database.ts`
- `src/hooks/use-cart.ts`
- `src/app/(dashboard)/caja/page.tsx`
- `src/components/pos/product-search.tsx`
- `src/components/pos/cart-item.tsx`
- `src/app/(dashboard)/reportes/page.tsx`
- `src/app/(dashboard)/cierre/page.tsx`
- `src/components/inventory/barcode-label.tsx`
- `src/components/inventory/product-table.tsx`
- `src/components/pos/sale-ticket.tsx`

Archivos observados como piezas clave:

- `src/app/(dashboard)/caja/page.tsx`
- `src/app/(dashboard)/gastos/page.tsx`
- `src/app/(dashboard)/inventario/page.tsx`
- `src/app/(dashboard)/cierre/page.tsx`
- `src/app/(dashboard)/reportes/page.tsx`
- `supabase/schema.sql`
- `supabase/functions.sql`
- `public/sw.js`

Siguiente paso recomendado:

- reforzar seguridad de Supabase y definir alcance funcional del asistente de inventario.

### 2026-03-17 - Inventario operativo

Resumen:

- Se agrego una vista util de `inventory_movements` dentro de la pantalla de inventario.
- Se incorporaron filtros por tipo de movimiento y refresco manual.
- Se registro movimiento automatico de stock inicial al crear productos con stock.
- Se registro movimiento automatico de ajuste manual cuando cambia el stock en edicion.
- El proyecto continua con `npm run lint` limpio.

Archivos tocados:

- `src/types/database.ts`
- `src/components/inventory/inventory-movement-list.tsx`
- `src/app/(dashboard)/inventario/page.tsx`
- `src/components/inventory/product-form.tsx`

Riesgos pendientes:

- La nueva RPC debe ejecutarse en Supabase (`functions.sql`) para quedar activa en el entorno real.
- Aun falta consolidar seguridad de acceso por rol para operaciones sensibles.

### 2026-03-17 - Inventario transaccional y filtros

Resumen:

- Se agrego la RPC `upsert_product_with_movement` para crear/editar producto y registrar movimiento en una sola transaccion.
- El formulario de producto ahora usa esa RPC en lugar de operaciones separadas desde cliente.
- La vista de movimientos ahora permite filtrar por tipo, socia y busqueda por producto/codigo.
- Se agrego exportacion CSV del resultado filtrado.
- El proyecto se mantiene con `npm run lint` limpio.

Archivos tocados:

- `supabase/functions.sql`
- `src/components/inventory/product-form.tsx`
- `src/components/inventory/inventory-movement-list.tsx`
- `src/app/(dashboard)/inventario/page.tsx`

Siguiente paso recomendado:

- ejecutar `supabase/functions.sql` en la base real y luego reforzar politicas RLS por rol.

### 2026-03-17 - Fiabilidad y registros

Resumen:

- Se fortalecieron constraints del schema para evitar datos invalidos (precios, stock, cantidades y metodos de pago).
- Se agrego tipo enum para razones de movimiento de inventario.
- Se endurecieron validaciones en funciones SQL (`decrement_stock`, `increment_stock`, `register_sale`, `upsert_product_with_movement`).
- Se mantiene enfoque de seguridad pragmatica, priorizando buen funcionamiento y trazabilidad.

Archivos tocados:

- `supabase/schema.sql`
- `supabase/functions.sql`
- `src/types/database.ts`

Siguiente paso recomendado:

- aplicar `schema.sql` y `functions.sql` en Supabase y validar un flujo completo (crear producto, ajustar stock, vender, revisar movimientos).

### 2026-03-17 - Patch de schema existente

Resumen:

- Se detecto que `schema.sql` falla al re-ejecutarse sobre una base ya creada (tipos/tablas existentes).
- Se agrego `supabase/schema_patch_existing.sql` para migrar en modo idempotente sin romper entorno actual.
- Se dejo aviso explicito en `schema.sql` para diferenciar uso en base nueva vs base existente.

Archivos tocados:

- `supabase/schema.sql`
- `supabase/schema_patch_existing.sql`

### 2026-03-17 - Fluidez de caja

Resumen:

- Se elimino la apertura automatica del dialogo de ticket al registrar venta.
- El ultimo ticket queda disponible con boton dedicado para imprimir cuando se necesite.
- Se elimino el toast de exito por cada escaneo para reducir ruido visual al cajero.
- Se mantiene feedback sonoro y errores solo cuando son relevantes.

Archivos tocados:

- `src/components/pos/cart.tsx`
- `src/app/(dashboard)/caja/page.tsx`

Siguiente paso recomendado:

- validar en operacion real de caja si el equipo quiere tambien atajo de teclado para imprimir ultimo ticket.

### 2026-03-17 - Inventario enfocado en ropa y fix de dialogo

Resumen:

- Se mantuvo el formulario sin precio de compra en UI; solo se captura precio de venta.
- Se aseguro que siempre se guarden tallas (si no se selecciona, queda `U` por defecto).
- Se corrigio el warning de Base UI en `DialogTrigger` configurando `nativeButton={false}` tambien en el trigger principal.
- La tabla de inventario ahora muestra tallas detectadas directamente en cada prenda y permite buscarlas.

Archivos tocados:

- `src/components/inventory/product-form.tsx`
- `src/components/inventory/product-table.tsx`
- `src/app/(dashboard)/inventario/page.tsx`

Siguiente paso recomendado:

- si se quiere control mas fino por talla (stock por S/M/L separado), crear tabla `product_variants` y migrar el flujo de venta a variantes.

### 2026-03-17 - Inventario por secciones y migracion inicial

Resumen:

- Se simplifico formulario de producto: sin tipo de prenda ni notas.
- Tallas ahora se escriben libremente en un campo unico.
- Se separo la operacion de inventario en pantallas:
  - `Inventario` para CRUD de productos;
  - `Altas y Bajas` para movimientos manuales de stock;
  - `Migracion` para importar Excel/CSV usando codigos de barras existentes.
- Se agrego RPC `adjust_product_stock` para registrar altas/bajas con movimiento auditado en una sola operacion.
- Se documento el flujo de migracion desde Sheyla.

Archivos tocados:

- `src/components/inventory/product-form.tsx`
- `src/components/inventory/product-table.tsx`
- `src/components/inventory/inventory-movement-list.tsx`
- `src/components/inventory/stock-adjustment-form.tsx`
- `src/app/(dashboard)/inventario/page.tsx`
- `src/app/(dashboard)/inventario/movimientos/page.tsx`
- `src/app/(dashboard)/inventario/migracion/page.tsx`
- `src/app/(dashboard)/layout.tsx`
- `supabase/functions.sql`
- `docs/MIGRACION_SHEYLA.md`

Siguiente paso recomendado:

- ejecutar `supabase/functions.sql` en Supabase para activar `adjust_product_stock` y validar en entorno real un alta, una baja y una importacion corta.

### 2026-03-17 - Limpieza de mojibake

Resumen:

- Se audito el repo buscando secuencias rotas de encoding (`Ã`, `Â`, `â†`, similares).
- Se confirmo que habia dos tipos de problema:
  - mojibake real en algunos textos de UI;
  - falsos positivos al leer archivos UTF-8 desde terminal con codificacion de salida inconsistente.
- Se corrigieron los textos realmente rotos en navegacion y componentes visibles.
- Se dejo el repo validado con `npm run lint`.

Archivos tocados:

- `src/app/(dashboard)/layout.tsx`
- `src/components/inventory/product-table.tsx`
- `docs/PLAN_MAESTRO.md`

Siguiente paso recomendado:

- si reaparecen textos rotos, revisar siempre con busqueda por secuencias `Ã|Â|â†` antes de editar por intuicion para no confundir UTF-8 sano con salida rota del terminal.
### 2026-03-17 - Migracion Sheyla ajustada al inventario real

Resumen:

- Se analizo un archivo real de inventario exportado desde Sheyla.
- Se confirmo que el reporte trae una fila de encabezado desplazada y no se debe asumir encabezado en la primera fila.
- Se ajusto el importador para detectar automaticamente la fila correcta de encabezados.
- `MIGUEL` se ignora automaticamente durante la importacion.
- `Marca` y `Categoria` quedan solo como fuentes para inferir socia, no como campos persistentes del producto.
- Si una fila no identifica socia claramente, el importador usa la socia por defecto elegida en pantalla.

Archivos tocados:

- `src/app/(dashboard)/inventario/migracion/page.tsx`
- `docs/MIGRACION_SHEYLA.md`

Siguiente paso recomendado:

- probar la importacion real con el archivo de Sheyla y revisar especificamente las filas que entren por socia por defecto para confirmar si conviene afinarlas mas.

### 2026-03-17 - Inventario con semantica visual clara

Resumen:

- Se separo visualmente identidad de socia, estado de stock y tipo de movimiento para evitar interpretaciones equivocadas.
- Rosa dejo de verse como color de error dentro de inventario; ahora las socias usan acentos suaves propios.
- El estado de stock paso a ser explicito con tres niveles: disponible, por agotarse y sin stock.
- La tabla de inventario ahora resume total, disponibles, por agotarse y sin stock antes del listado.
- Las altas y bajas ahora usan semantica operativa mas clara: alta en verde, baja en ambar, venta en azul dentro del historial.
- Se simplifico la lectura del formulario y del flujo de movimientos para que el cajero confirme mas rapido codigo, socia, stock y accion.

Archivos tocados:

- `src/components/inventory/inventory-ui.ts`
- `src/components/inventory/product-table.tsx`
- `src/components/inventory/product-form.tsx`
- `src/components/inventory/stock-adjustment-form.tsx`
- `src/components/inventory/inventory-movement-list.tsx`
- `src/app/(dashboard)/inventario/page.tsx`
- `src/app/(dashboard)/inventario/movimientos/page.tsx`

Siguiente paso recomendado:

- probar inventario con uso real en caja y medir si conviene agregar una vista aun mas rapida para busqueda por codigo + ajuste inmediato sin dropdown.

### 2026-03-17 - Regla de depuracion para inventario real

Resumen:

- Se analizo el archivo real `INVEN.xlsx` y se confirmo que `Marca` es el dato util para decidir socio en la migracion.
- Se fijo una lista negra de socios/registros viejos que no deben entrar al sistema actual.
- El importador ahora ignora automaticamente filas marcadas como `MIGUEL`, `DIANA`, `MARCA GENERICA` y `EDISON`.
- `Categoria` queda relegada a apoyo secundario y ya no manda sobre la lectura principal del Excel real.

Archivos tocados:

- `src/app/(dashboard)/inventario/migracion/page.tsx`
- `docs/MIGRACION_SHEYLA.md`

Siguiente paso recomendado:

- antes de importar en serio, correr el archivo completo y revisar solo las excepciones tecnicas reales: barras faltantes, barras duplicados y precios invalidos.

### 2026-03-17 - Reset seguro antes de reimportar INVEN

Resumen:

- Se confirmo que el inventario cargado antes no usaba necesariamente los barcodes reales del archivo definitivo.
- Para evitar duplicados al importar `INVEN.xlsx`, se preparo un reset seguro del inventario actual.
- El reset elegido no borra ventas, gastos ni sesiones de caja.
- La estrategia es dejar todos los productos con stock `0`, desactivarlos y limpiar `inventory_movements`.
- Luego la importacion nueva puede crear o reactivar productos usando `BARRAS` como barcode real.

Archivos tocados:

- `supabase/reset_inventory_for_inven.sql`
- `docs/MIGRACION_SHEYLA.md`

Siguiente paso recomendado:

- ejecutar `supabase/reset_inventory_for_inven.sql` en Supabase y solo despues importar `INVEN.xlsx`.
