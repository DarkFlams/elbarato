# SoftwarePOS

POS web para un negocio familiar con foco en tres frentes:

1. Registrar ventas por socia.
2. Controlar gastos individuales y compartidos.
3. Facilitar inventario, reportes y operacion diaria.

Estado auditado localmente el 17 de marzo de 2026.

## Que existe hoy

- POS con busqueda manual y escaner por codigo de barras.
- Carrito de venta con agrupacion por socia.
- Sesion de caja automatica con apertura y cierre.
- Registro de gastos individuales y compartidos.
- Reportes historicos por sesion.
- Inventario con CRUD base y etiquetas de codigo de barras.
- Exportacion de reportes a Excel y PDF.
- Base PWA inicial con `manifest.json` y `public/sw.js`.
- Integracion base con Supabase.

## Que falta madurar

- Documentacion funcional y tecnica mas completa.
- Endurecer validaciones de negocio en base de datos.
- Flujo robusto de inventario asistido e inteligente.
- Reportes agregados por rango de fechas y mejores metricas.
- Seguridad, auditoria, backups y despliegue.
- Pruebas automaticas.

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Supabase
- Zustand
- TanStack Query
- jsPDF / XLSX

## Estructura principal

- `src/app/(dashboard)/caja`: pantalla principal del POS.
- `src/app/(dashboard)/gastos`: registro y consulta de gastos.
- `src/app/(dashboard)/inventario`: gestion de productos y stock.
- `src/app/(dashboard)/cierre`: cierre de caja y exportacion.
- `src/app/(dashboard)/reportes`: historial de sesiones.
- `supabase/schema.sql`: esquema base de datos.
- `supabase/functions.sql`: funciones RPC para stock.
- `docs/PLAN_MAESTRO.md`: hoja de ruta y bitacora del proyecto.

## Configuracion local

1. Instala dependencias:

```bash
npm install
```

2. Configura variables en `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

3. Ejecuta el esquema y funciones en Supabase:

- `supabase/schema.sql`
- `supabase/functions.sql`

4. Inicia desarrollo:

```bash
npm run dev
```

## Modelo de negocio actual

- Cada producto pertenece a una socia.
- Cada venta se registra dentro de una sesion de caja.
- Los gastos pueden ser:
  - `individual`: descuentan a una sola socia.
  - `shared`: se reparten entre todas las socias.
- El cierre calcula ventas, gastos y neto por socia.

## Documento de continuidad

La referencia principal para seguir el proyecto esta en:

- `docs/PLAN_MAESTRO.md`

Ese archivo debe actualizarse cuando cambie el alcance, se complete una fase o aparezcan nuevas decisiones importantes.
