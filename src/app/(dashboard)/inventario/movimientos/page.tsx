/**
 * @file inventario/movimientos/page.tsx
 * @description Pantalla dedicada para altas y bajas de inventario.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StockAdjustmentForm } from "@/components/inventory/stock-adjustment-form";
import { InventoryMovementList } from "@/components/inventory/inventory-movement-list";
import type { Partner } from "@/types/database";

export default function InventarioMovimientosPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchPartners = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("partners")
        .select("*")
        .order("name");

      if (error) throw error;
      setPartners((data as Partner[]) || []);
    } catch (err) {
      console.error("[InventarioMovimientosPage] fetchPartners error:", err);
    }
  }, []);

  useEffect(() => {
    fetchPartners();
  }, [fetchPartners]);

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
        <StockAdjustmentForm
          onAdjusted={() => setRefreshTrigger((value) => value + 1)}
        />
      </div>

      <div className="flex-1 min-h-0">
        <InventoryMovementList
          partners={partners}
          refreshTrigger={refreshTrigger}
        />
      </div>
    </div>
  );
}
