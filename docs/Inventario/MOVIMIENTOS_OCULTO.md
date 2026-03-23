# Historial de movimientos oculto

Fecha: 2026-03-23

## Estado

Se oculto temporalmente el bloque visual de **Movimientos de inventario** dentro de la pantalla **Altas y Bajas** porque actualmente no aporta valor operativo claro y agrega ruido visual.

## Que se hizo

- **Altas y Bajas** sigue visible en el sidebar.
- La ruta sigue existiendo en `src/app/(dashboard)/inventario/movimientos/page.tsx`.
- Se dejo visible solo el formulario operativo de ajustes manuales.
- El componente oculto sigue existiendo:
  - `src/components/inventory/inventory-movement-list.tsx`

## Como reactivarlo

Volver a renderizar `InventoryMovementList` dentro de `src/app/(dashboard)/inventario/movimientos/page.tsx`.

Referencia anterior:

```tsx
<div className="flex-1 min-h-0">
  <InventoryMovementList
    partners={partners}
    refreshTrigger={refreshTrigger}
  />
</div>
```

## Nota

Esto es solo un ocultamiento de UI. No se removio logica, ruta, tipos ni funciones relacionadas para poder reevaluarlo mas adelante.
