/**
 * @file inventory-movement-list.tsx
 * @description Lista de movimientos recientes de inventario.
 */

"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Clock3,
  RefreshCw,
  History,
  TrendingDown,
  TrendingUp,
  Download,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { listInventoryMovementsLocalFirst } from "@/lib/local/inventory-movements";
import { cn } from "@/lib/utils";
import type {
  InventoryMovementWithProduct,
  Partner,
} from "@/types/database";
import {
  getMovementVisual,
  getPartnerVisual,
} from "./inventory-ui";

interface InventoryMovementListProps {
  partners: Partner[];
  refreshTrigger?: number;
}

type MovementFilter =
  | "all"
  | "sale"
  | "restock"
  | "manual_adjustment"
  | "return"
  | "initial_stock"
  | "old_stock";

const FILTERS: { value: MovementFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "sale", label: "Ventas" },
  { value: "restock", label: "Altas" },
  { value: "manual_adjustment", label: "Bajas/Ajustes" },
  { value: "return", label: "Devoluciones" },
  { value: "initial_stock", label: "Inicial" },
  { value: "old_stock", label: "Ropa Vieja" },
];

const REASON_LABEL: Record<string, string> = {
  sale: "Venta",
  restock: "Alta",
  manual_adjustment: "Baja manual",
  return: "Devolucion",
  initial_stock: "Stock inicial",
  old_stock: "Envio a Bodega",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeCsv(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function InventoryMovementList({
  partners,
  refreshTrigger = 0,
}: InventoryMovementListProps) {
  const [movements, setMovements] = useState<InventoryMovementWithProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<MovementFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchMovements = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listInventoryMovementsLocalFirst();
      setMovements((data as InventoryMovementWithProduct[]) || []);
    } catch (err) {
      console.error("[InventoryMovementList] fetchMovements error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements, refreshTrigger]);

  const filteredMovements = useMemo(() => {
    return movements.filter((movement) => {
      if (typeFilter !== "all" && movement.reason !== typeFilter) {
        return false;
      }

      if (ownerFilter !== "all" && movement.product?.owner?.id !== ownerFilter) {
        return false;
      }

      if (!searchQuery.trim()) return true;

      const term = searchQuery.trim().toLowerCase();
      const name = movement.product?.name?.toLowerCase() || "";
      const barcode = movement.product?.barcode?.toLowerCase() || "";
      return name.includes(term) || barcode.includes(term);
    });
  }, [movements, ownerFilter, searchQuery, typeFilter]);

  const groupedMovements = useMemo(() => {
    const groups: { dateKey: string; items: typeof filteredMovements }[] = [];
    
    for (const movement of filteredMovements) {
      const dateObj = new Date(movement.created_at);
      
      let dateKey = "";
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const isToday = dateObj.toDateString() === today.toDateString();
      const isYesterday = dateObj.toDateString() === yesterday.toDateString();
      
      if (isToday) {
        dateKey = "Hoy";
      } else if (isYesterday) {
        dateKey = "Ayer";
      } else {
        dateKey = dateObj.toLocaleDateString("es-EC", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        dateKey = dateKey.charAt(0).toUpperCase() + dateKey.slice(1);
      }
      
      let group = groups.find(g => g.dateKey === dateKey);
      if (!group) {
        group = { dateKey, items: [] };
        groups.push(group);
      }
      group.items.push(movement);
    }
    return groups;
  }, [filteredMovements]);

  const exportCsv = () => {
    if (filteredMovements.length === 0) return;

    const header = [
      "Fecha",
      "Producto",
      "Codigo",
      "Socia",
      "Tipo",
      "Cantidad",
      "Referencia",
    ];

    const rows = filteredMovements.map((movement) => [
      formatDateTime(movement.created_at),
      movement.product?.name || "Producto eliminado",
      movement.product?.barcode || "-",
      movement.product?.owner?.display_name || "-",
      REASON_LABEL[movement.reason] || movement.reason,
      String(movement.quantity_change),
      movement.reference_id || "-",
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `movimientos_inventario_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="space-y-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-700" />
            <span className="text-sm font-semibold text-slate-900">
              Movimientos de inventario
            </span>
            <Badge variant="outline" className="text-[10px]">
              {filteredMovements.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              onClick={exportCsv}
              disabled={filteredMovements.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              onClick={fetchMovements}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              onClick={() => setTypeFilter(item.value)}
              className={
                typeFilter === item.value
                  ? "rounded-md border border-slate-900 bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-sm"
                  : "rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
              }
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setOwnerFilter("all")}
            className={
              ownerFilter === "all"
                ? "rounded-md border border-slate-900 bg-slate-900 px-2.5 py-1 text-xs font-medium text-white shadow-sm"
                : "rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
            }
          >
            Todas las socias
          </button>
          {partners.map((partner) => {
            const visual = getPartnerVisual(partner.name);
            const isActive = ownerFilter === partner.id;

            return (
              <button
                key={partner.id}
                onClick={() => setOwnerFilter(partner.id)}
                className={
                  isActive
                    ? "rounded-md border px-2.5 py-1 text-xs font-medium shadow-sm"
                    : "rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
                }
                style={
                  isActive
                    ? {
                        borderColor: visual.softBorder,
                        color: visual.softText,
                        backgroundColor: visual.softBackground,
                      }
                    : undefined
                }
              >
                {partner.display_name}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por producto o codigo..."
            className="border-slate-200 bg-white pl-9 shadow-sm focus-visible:border-slate-900 focus-visible:ring-slate-900/10"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex h-[160px] items-center justify-center text-slate-500">
            <Clock3 className="mr-2 h-4 w-4 animate-spin" />
            Cargando movimientos...
          </div>
        ) : filteredMovements.length === 0 ? (
          <div className="flex h-[160px] flex-col items-center justify-center gap-2 text-slate-500">
            <History className="h-8 w-8 opacity-40" />
            <p className="text-sm">No hay movimientos para este filtro</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 pb-6">
            {groupedMovements.map((group) => (
              <div key={group.dateKey}>
                <div className="sticky top-0 z-10 border-y border-slate-100 bg-slate-50/95 px-4 py-1.5 backdrop-blur-md">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {group.dateKey}
                  </h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {group.items.map((movement) => {
                    const owner = movement.product?.owner;
              const ownerVisual = owner ? getPartnerVisual(owner.name) : null;
              const movementVisual = getMovementVisual(movement.reason);
              const qtyText = `${movement.quantity_change > 0 ? "+" : ""}${movement.quantity_change}`;
              const qtyColor = movement.quantity_change > 0 ? "text-emerald-600" : movement.quantity_change < 0 ? "text-rose-600" : "text-slate-900";

              return (
                <div
                  key={movement.id}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      movementVisual.iconClassName
                    )}
                  >
                    {movement.quantity_change >= 0 ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : (
                      <TrendingDown className="h-4 w-4" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {movement.product?.name || "Producto eliminado"}
                      </p>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-medium text-slate-700">
                        {REASON_LABEL[movement.reason] || movement.reason}
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="font-mono">
                        {movement.product?.barcode || "-"}
                      </span>
                      {owner && ownerVisual ? (
                        <>
                          <span className="text-slate-300">•</span>
                          <span className="flex items-center gap-1.5 font-medium text-slate-700">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: ownerVisual.accent }}
                            />
                            {owner.display_name}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className={cn("font-mono text-sm font-semibold", qtyColor)}>
                      {qtyText}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {formatDateTime(movement.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
