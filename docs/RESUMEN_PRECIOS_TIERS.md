# Resumen Rapido: Precios x3 / x6 / x12

## Objetivo
El sistema ya no maneja solo un precio de venta por producto.

Ahora cada producto puede tener:

- `PVP normal`
- `PVP x3`
- `PVP x6`
- `PVP x12`

Esto permite vender la misma prenda con distintos precios sin duplicar productos.

## Arquitectura real del programa
Este programa no trabaja solo en Supabase ni solo en local.

Trabaja en modo mixto:

- `Local primero` en la PC con SQLite
- `Supabase` como backend remoto y sincronización

Eso significa:

- la PC puede seguir funcionando aunque Supabase no responda en ese momento
- ventas, gastos, productos y cambios de inventario pueden guardarse localmente
- después esas operaciones se mandan a Supabase mediante una cola de sincronización

En otras palabras:

- la operación diaria ocurre primero en local
- Supabase es la copia remota y compartida

## Qué significa eso para este caso
Los precios `x3/x6/x12` ya funcionan en local.

Por eso:

- la importación de precios sí corre en la PC
- el inventario local sí cambia

Pero si Supabase no tiene el SQL nuevo:

- la cola remota falla
- aparecen miles de operaciones fallidas en `Operaciones Offline`

## Como esta pensado el programa

### 1. Inventario / Lista de precios
Cada producto sigue siendo un solo producto.

Lo nuevo es que ahora tiene precios adicionales:

- `sale_price` = precio normal
- `sale_price_x3`
- `sale_price_x6`
- `sale_price_x12`

La pantalla `/precios` existe para:

- ver toda la lista de precios
- editar precios rapido
- importar precios desde Excel

### 2. Caja
En caja no se debe ver una UI cargada o fea.

La idea correcta es:

- el precio unitario se ve normal
- al hacer click sobre el precio unitario se abre un menu
- desde ese menu se elige:
  - `Normal`
  - `x3`
  - `x6`
  - `x12`

Si el usuario cambia el total manualmente, esa linea pasa a modo:

- `manual`

Eso se guarda para auditoria.

### 3. Venta guardada
Cuando se registra una venta, cada item guarda:

- `unit_price`
- `price_tier`

Ejemplos de `price_tier`:

- `normal`
- `x3`
- `x6`
- `x12`
- `manual`

Contablemente el valor real que manda es `unit_price`.
`price_tier` sirve para saber de donde salio ese precio.

## Importacion de Excel
Se hizo una importacion separada solo para precios.

Archivo esperado:

- `docs/Inventario/precios.xlsx`

La importacion:

- cruza productos por `SKU`
- si no encuentra por `SKU`, intenta por `barcode`
- actualiza precios
- opcionalmente puede actualizar stock desde `Total STOCK`

No reemplaza la migracion vieja de inventario.
Eso fue intencional para no romper el flujo anterior.

## Problema actual importante
La app local ya entiende `x3/x6/x12`, pero Supabase todavia no estaba actualizado cuando se hizo la importacion.

Por eso quedaron miles de operaciones fallidas en la cola local con este error:

`Could not find the function public.upsert_product_with_movement(...) in the schema cache`

## Que significa ese error
No es que el producto este mal.
No es que el Excel este mal.
No es que la PC este offline.

Significa que la app esta intentando llamar una version nueva de esta RPC:

- `upsert_product_with_movement`

pero en Supabase sigue estando la version vieja, sin soporte para:

- `p_sale_price_x3`
- `p_sale_price_x6`
- `p_sale_price_x12`

## Como se corrige
En Supabase SQL Editor hay que ejecutar, en este orden:

1. `supabase/schema_patch_existing.sql`
2. `supabase/functions.sql`

Despues de eso, en la app:

1. ir a `Operaciones Offline`
2. hacer click en `Reintentar Fallidos`
3. hacer click en `Sincronizar Ahora`

## Estado actual

- La base local ya soporta precios por tier.
- La lista de precios ya importa desde Excel.
- Caja ya puede manejar tiers.
- El bloqueo actual es de sincronizacion remota por SQL viejo en Supabase.

## Archivos clave

- `src/app/(dashboard)/precios/page.tsx`
- `src/app/(dashboard)/precios/importar/page.tsx`
- `src/components/pos/cart-item.tsx`
- `src/hooks/use-cart.ts`
- `supabase/schema_patch_existing.sql`
- `supabase/functions.sql`

## Resumen corto para explicarle a alguien
El programa ahora maneja varios precios por producto (`normal`, `x3`, `x6`, `x12`) sin duplicar inventario.
Eso ya funciona localmente.
Lo que falta es actualizar Supabase con el SQL nuevo para que la cola offline deje de fallar al sincronizar.
