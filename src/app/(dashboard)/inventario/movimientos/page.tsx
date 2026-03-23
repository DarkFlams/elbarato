/**
 * @file inventario/movimientos/page.tsx
 * @description Pantalla dedicada para altas y bajas de inventario.
 */

"use client";

import { ArrowUpDown } from "lucide-react";
import { StockAdjustmentForm } from "@/components/inventory/stock-adjustment-form";

export default function InventarioMovimientosPage() {
  return (
    <div className="flex flex-col h-full gap-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900">
          <ArrowUpDown className="h-5 w-5 text-slate-700" />
          Altas y Bajas
        </h1>
        <p className="text-sm text-slate-500">
          Registra movimientos manuales sin confundir ventas normales con
          errores de inventario.
        </p>
      </div>

      <div className="space-y-4">
        <StockAdjustmentForm />
      </div>
    </div>
  );
}
