# El Barato v0.1.14

- Corrige el bloqueo total del desktop cuando una actualizacion del catalogo local falla a mitad de proceso.
- La app ahora conserva una base local previamente valida y deja el refresco de catalogo en segundo plano.
- Corrige el choque de productos locales ya sincronizados contra `remote_id` al volver a descargar inventario.
- Mejora el detalle del error del bootstrap local para no mostrar solo `Error desconocido`.
- Mantiene el catalogo local usable mientras termina la actualizacion de socios, productos, stock y precios.
