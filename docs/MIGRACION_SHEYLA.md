# Migracion Desde Sheyla

Guia practica para pasar inventario existente a este sistema sin reimprimir etiquetas.

## Objetivo

- reutilizar los codigos de barras ya impresos;
- cargar stock y precios en bloque;
- evitar registrar prenda por prenda manualmente.

## Requisito clave

El codigo de barras en el archivo de Sheyla debe ser el mismo que esta pegado en la prenda.

Con eso, el POS seguira escaneando exactamente igual.

## Flujo recomendado

0. Si el inventario anterior fue cargado con codigos incorrectos, primero ejecuta `supabase/reset_inventory_for_inven.sql`.
1. En Sheyla, exporta inventario a Excel (`.xlsx`) o CSV.
2. El importador detecta automaticamente la fila de encabezados aunque el reporte tenga titulo arriba.
3. Verifica que el archivo tenga al menos estas columnas:
   - codigo de barras
   - nombre de producto
   - precio de venta
   - stock
4. Opcionales utiles:
   - socia (si no viene, el importador usa la socia por defecto)
   - stock minimo
   - tallas
5. En este sistema abre `Inventario > Migracion`.
6. Sube el archivo y revisa el preview.
7. Ejecuta `Importar archivo`.
8. Revisa el resumen final (creados, actualizados, ignorados y fallidos).

## Reglas especificas para tu archivo actual

- `MIGUEL`, `DIANA`, `MARCA GENERICA` y `EDISON`: se ignoran automaticamente por ser socios viejos o registros que no deben entrar al sistema actual.
- `Marca`: en el Excel real se toma como la fuente principal para inferir la socia.
- `Categoria`: queda como apoyo secundario solo si hace falta inferir la socia.
- Si una fila no trae socia clara, se usa la socia por defecto seleccionada en pantalla.
- Si no hay socia clara y tampoco hay socia por defecto, la fila queda como error.

## Reset previo recomendado para INVEN.xlsx

Si ya habias importado productos usando un campo incorrecto como barcode, no conviene importar `INVEN.xlsx` encima sin limpiar antes.

Para ese caso existe:

- `supabase/reset_inventory_for_inven.sql`

Ese script:

- pone `stock = 0` a todos los productos;
- desactiva todos los productos (`is_active = false`);
- elimina `inventory_movements`;
- conserva ventas, gastos y sesiones de caja.

Asi el nuevo archivo puede entrar limpio usando `BARRAS` como barcode real.

## Columnas que reconoce el importador

No necesitas nombres exactos. El importador reconoce alias comunes:

- barcode: `barcode`, `codigo`, `codigobarras`, `sku`
- nombre: `name`, `nombre`, `producto`, `prenda`
- precio: `precioventa`, `venta`, `pvp`, `precio`
- stock: `stock`, `existencia`, `cantidad`, `saldo`
- socia: `socia`, `owner`, `duena`, `partner`
- stock minimo: `minstock`, `stockminimo`, `minimo`
- tallas: `talla`, `tallas`, `size`, `sizes`

## Buenas practicas antes de importar

- Quita filas vacias y encabezados duplicados.
- No mezcles productos distintos con el mismo codigo.
- Asegura que precio y stock sean numericos.
- Haz una prueba primero con 10 filas.

## Resultado esperado

- Si el codigo no existe en este sistema: crea producto nuevo.
- Si el codigo ya existe: actualiza producto existente.
- Queda registro en movimientos de inventario para trazabilidad.
