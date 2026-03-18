# Ropa Vieja / Bodega / Remate

> **⚠️ ESTADO: OCULTO**
> Esta funcionalidad está completamente desarrollada en el frontend pero **oculta** de la UI.
> Para activarla se necesita:
> 1. Ejecutar `supabase/migration_bodega_remate.sql` en Supabase SQL Editor
> 2. Descomentar/reactivar el código en los archivos listados abajo
>
> **Archivos con lógica oculta (buscar `docs/ropa-vieja.md`):**
> - `src/components/inventory/stock-adjustment-form.tsx` — botón "Ropa vieja"
> - `src/hooks/use-cart.ts` — lógica de `clearance_price`
> - `src/components/pos/product-search.tsx` — badge REMATE y precio tachado
> - `src/app/(dashboard)/layout.tsx` — enlace "Bodega" en sidebar
> - `src/app/(dashboard)/bodega/page.tsx` — página completa (existe pero no se accede)

Este documento explica el funcionamiento de la nueva característica de gestión de inventario para ropa antigua, descolorida o invendible.

## Flujo General

El ciclo de vida de un producto marcado como "Ropa Vieja" consta de las siguientes etapas:

1. **Alta a Bodega:** El producto se retira del inventario activo y se almacena en la "Bodega". Puede ser un retiro total (todo el stock) o parcial (solo algunas unidades).
2. **Gestión en Bodega:** En la sección "Bodega", puedes ver cuánto tiempo lleva cada prenda almacenada (con indicadores visuales de antigüedad) y decidir su destino final.
3. **Destino Final:**
   - **Remate:** La prenda vuelve al "Punto de Venta" y al "Inventario" activo, pero con un precio rebajado y una etiqueta visual de `REMATE`.
   - **Desechar:** La prenda se retira permanentemente del sistema (baja definitiva). Su registro se conserva únicamente para fines de auditoría.

---

## 1. Enviar a Bodega (Marcar como Ropa Vieja)

Para enviar un producto a Bodega, utiliza el formulario de **Altas y Bajas** (`/inventario/movimientos`):

1. Escanea o busca la prenda.
2. Selecciona la opción **"Ropa vieja"** (icono rojo de caja).
3. Ingresa la **Cantidad** de unidades que deseas enviar a Bodega.
   - Si ingresas **todo el stock disponible**, el producto se desactivará por completo y desaparecerá del Punto de Venta.
   - Si ingresas **una cantidad menor al stock**, el sistema restará esas unidades del inventario activo y las sumará a `bodega_stock`. El producto sigue disponible para la venta normal con el stock restante.
4. Confirma la acción. Se registrará un movimiento de inventario de tipo `Envío a Bodega`.

> **Nota**: Las unidades enviadas a bodega se acumulan en la columna `bodega_stock`. Un mismo producto puede tener unidades activas en venta y unidades en bodega al mismo tiempo.

---

## 2. Gestión en Bodega

La página de **Bodega** (`/bodega`) lista todos los productos que tienen unidades en bodega (`bodega_stock > 0`).

Cada producto muestra:
- **Unidades en bodega**: Cuántas unidades están retiradas.
- **Unidades activas** (si el producto sigue activo): Cuántas unidades siguen en venta.
- **Indicador de antigüedad** (si fue retirado completamente): Tiempo desde que se envió a bodega.

---

## 3. Remate vs Desecho

Desde la lista de Bodega, tienes dos opciones principales para cada producto:

### Opción A: Crear Remate
Si consideras que la prenda puede venderse a un precio menor, crea un remate:
1. Haz clic en el botón amarillo **"Remate"**.
2. Ingresa el **Precio de remate** (el sistema sugiere automáticamente el 50% del precio original).
3. Ingresa la **Cantidad** de prendas a reingresar como remate (stock).
4. Confirma.

**Efectos del Remate:**
- El producto desaparece de la Bodega y vuelve a estar **activo** en el inventario.
- En el **Punto de Venta**, aparecerá con un distintivo naranja que dice `REMATE`.
- Al agregarlo al carrito, el sistema utilizará automáticamente el **precio de remate** en lugar del precio original. El precio original se mostrará tachado.

### Opción B: Desechar
Si la prenda es irrecuperable (rota, manchada), puedes desecharla:
1. Haz clic en el botón rojo **"Desechar"**.
2. Haz clic en **"Confirmar"** para verificar.

**Efectos del Desecho:**
- El producto se retira permanentemente de la Bodega.
- No volverá al inventario activo.
- El registro no se borra de la base de datos (para mantener un historial contable) pero se marca mediante la columna `disposed_at`.

---

## Detalles Técnicos

- **Base de datos:**
  - `products.is_clearance`: Booleano que indica si está en remate.
  - `products.clearance_price`: Precio especial si `is_clearance` es verdadero.
  - `products.bodega_at`: Fecha en la que el producto entró por completo a Bodega (se usa para calcular la antigüedad).
  - `products.disposed_at`: Fecha en la que el producto fue desechado permanentemente.
  - `inventory_movement_reason`: Se añadió el enum `old_stock`.

- **RPCs de Supabase:**
  - `send_product_to_bodega(p_product_id, p_quantity)`: Reduce stock. Si `p_quantity == stock`, desactiva el producto y setea `bodega_at`.
  - `create_remate(p_product_id, p_clearance_price, p_stock)`: Reactiva el producto de la bodega aplicando modo remate.
  - `dispose_product(p_product_id)`: Marca el producto con `disposed_at`.
