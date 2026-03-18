/**
 * @file ventas/page.tsx
 * @description Lista Profesional de Ventas (SaaS Style).
 *              Tabla plana limpia sin accordions, con drawer detalle.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ShoppingBag,
  FilterX,
  Clock,
  Loader2,
  ReceiptText,
  Download,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { getPartnerConfig, getPartnerConfigFromPartner } from "@/lib/partners";
import type { Partner } from "@/types/database";
import {
  SaleDetailDrawer,
  type SaleDetailData,
} from "@/components/sales/sale-detail-drawer";
import { exportSalesToExcel, exportSalesToPdf, type SaleExportData } from "@/lib/export-utils";

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function VentasPage() {
  const [sales, setSales] = useState<SaleDetailData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedSale, setSelectedSale] = useState<SaleDetailData | null>(null);
  const [filterPartner, setFilterPartner] = useState<string | null>(null);

  const fetchSales = useCallback(async () => {
    setIsLoading(true);
    try {
      const supabase = createClient();
      let query = supabase
        .from("sales")
        .select(
          `
          id, 
          created_at, 
          total, 
          payment_method, 
          sold_by,
          sale_items(
            id,
            product_name,
            quantity,
            unit_price,
            subtotal,
            owner_id
          )
        `
        )
        .order("created_at", { ascending: false });

      if (fromDate) query = query.gte("created_at", `${fromDate}T00:00:00`);
      if (toDate) query = query.lte("created_at", `${toDate}T23:59:59.999`);
      if (!fromDate && !toDate) query = query.limit(50); // Default limit

      const [salesRes, partnersRes] = await Promise.all([
        query,
        supabase.from("partners").select("id, name, display_name, color_hex"),
      ]);

      if (salesRes.error) throw salesRes.error;

      const partnerMap: Record<string, Partner> = {};
      for (const p of (partnersRes.data || []) as Partner[]) {
        partnerMap[p.id] = p;
        partnerMap[p.name] = p; 
        const normName = p.name ? p.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "") : "";
        if (normName) partnerMap[normName] = p;
      }

      const formattedSales: SaleDetailData[] = (salesRes.data || []).map(
        (s: any) => {
          const rawSoldBy = s.sold_by || "";
          const normSoldBy = rawSoldBy.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
          const sold_by_partner = partnerMap[s.sold_by] || partnerMap[normSoldBy] || null;

          return {
            id: s.id,
            created_at: s.created_at,
            total: Number(s.total),
            payment_method: s.payment_method,
            sold_by_partner,
            sale_items: (s.sale_items || []).map((item: any) => ({
              ...item,
              unit_price: Number(item.unit_price),
              subtotal: Number(item.subtotal),
              quantity: Number(item.quantity),
              partner: partnerMap[item.owner_id] || null,
            })),
          };
        }
      );

      setSales(formattedSales);
    } catch (err) {
      console.error("[VentasPage] fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  const setPresetRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setFromDate(formatDateInput(start));
    setToDate(formatDateInput(end));
  };

  const clearFilters = () => {
    setFromDate("");
    setToDate("");
  };

  const hasFilters = Boolean(fromDate || toDate);

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("es-EC", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const fmtTime = (d: string) =>
    new Date(d).toLocaleTimeString("es-EC", {
      hour: "2-digit",
      minute: "2-digit",
    });

  const filteredSales = sales.reduce<Array<SaleDetailData & { displayTotal: number; displayItems: typeof sales[0]['sale_items'] }>>((acc, s) => {
    if (!filterPartner) {
      acc.push({ ...s, displayTotal: s.total, displayItems: s.sale_items });
      return acc;
    }
    
    // Solo incluir el ticket si tiene prendas que pertenecen a la socia seleccionada
    const partnerItems = s.sale_items.filter(item => {
      const conf = getPartnerConfigFromPartner(item.partner);
      return conf.key === filterPartner;
    });

    if (partnerItems.length > 0) {
      const saleSubtotal = partnerItems.reduce((sum, item) => sum + item.subtotal, 0);
      acc.push({
        ...s,
        displayTotal: saleSubtotal,
        displayItems: partnerItems,
      });
    }

    return acc;
  }, []);

  const totalFilteredAmount = filteredSales.reduce((sum, s) => sum + s.displayTotal, 0);

  const getUniqueOwnersConfigs = (items: typeof sales[0]['sale_items']) => {
    const map = new Map<string, ReturnType<typeof getPartnerConfigFromPartner>>();
    items.forEach(item => {
      const conf = getPartnerConfigFromPartner(item.partner);
      if (conf.displayName && conf.displayName !== "Sin nombre" && !map.has(conf.key)) {
        map.set(conf.key, conf);
      }
    });
    return Array.from(map.values());
  };

  const prepareExportData = (): SaleExportData[] => {
    return filteredSales.map((sale) => {
      const uniqueOwners = getUniqueOwnersConfigs(sale.displayItems);
      const ownerNames = uniqueOwners.length > 0 
        ? uniqueOwners.map(o => o.displayName).join(", ") 
        : "Sin especificar";

      const productsSummary = sale.displayItems
        .map((item) => `${item.quantity}x ${item.product_name}`)
        .join(", ");
      
      return {
        id: sale.id.slice(0, 8),
        date: fmtDate(sale.created_at),
        time: fmtTime(sale.created_at),
        partner: ownerNames,
        products: productsSummary || "Sin items detallados",
        method: sale.payment_method === "cash" ? "Efectivo" : "Transferencia",
        total: sale.displayTotal,
      };
    });
  };

  const handleExportExcel = () => {
    exportSalesToExcel(prepareExportData());
  };

  const handleExportPdf = () => {
    exportSalesToPdf(prepareExportData());
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900">
            <ShoppingBag className="h-5 w-5 text-slate-700" />
            Lista de Ventas
          </h1>
          <p className="text-sm text-muted-foreground">
            Revisión detallada de todos los tickets generados.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="h-9">
            <Download className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf} className="h-9 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors">
            <FileText className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-1">
        {/* Partner Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 hide-scrollbar">
          <button
            onClick={() => setFilterPartner(null)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-all ${
              filterPartner === null
                ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            Todas
          </button>
          {["rosa", "lorena", "yadira"].map((key) => {
            const conf = getPartnerConfig({ name: key });
            const isSelected = filterPartner === key;
            return (
              <button
                key={key}
                onClick={() => setFilterPartner(isSelected ? null : key)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-all ${
                  isSelected
                    ? "shadow-sm"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                }`}
                style={
                  isSelected
                    ? {
                        borderColor: conf.colorBorder,
                        backgroundColor: conf.colorLight,
                        color: conf.color,
                      }
                    : undefined
                }
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: conf.color }}
                />
                {conf.displayName}
              </button>
            );
          })}
        </div>

        {/* Date Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-auto bg-slate-50 border-slate-200"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-auto bg-slate-50 border-slate-200"
          />
          <Button
            variant="outline"
            className="border-slate-200 text-slate-700 bg-white"
            onClick={clearFilters}
            disabled={!hasFilters}
          >
            <FilterX className="h-4 w-4 mr-2" />
            Limpiar
          </Button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          <div className="flex bg-slate-100/50 p-1 rounded-lg border border-slate-200">
            {[
              { label: "Hoy", days: 1 },
              { label: "7 días", days: 7 },
              { label: "30 días", days: 30 },
            ].map((preset) => (
              <Button
                key={preset.days}
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-slate-600 hover:text-slate-900"
                onClick={() => setPresetRange(preset.days)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <span className="text-xs text-slate-400 ml-auto font-medium">
            {filteredSales.length} ticket{filteredSales.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Table Content */}
      <div className="flex-1 flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-0">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin mb-4" />
            <p className="text-sm font-medium">Cargando ventas...</p>
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <ReceiptText className="h-12 w-12 mb-4 text-slate-300" strokeWidth={1.5} />
            <p className="text-base font-medium text-slate-600 mb-1">
              No hay ventas registradas
            </p>
            <p className="text-sm">
              {hasFilters
                ? "Prueba cambiando el rango de fechas"
                : "Realiza tu primera venta en el terminal"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <ScrollArea className="flex-1">
              <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 shadow-sm">
                <tr>
                  <th className="px-4 py-3 font-semibold text-xs text-slate-500 uppercase tracking-widest">
                    Orden #
                  </th>
                  <th className="px-4 py-3 font-semibold text-xs text-slate-500 uppercase tracking-widest">
                    Fecha
                  </th>
                  <th className="px-4 py-3 font-semibold text-xs text-slate-500 uppercase tracking-widest">
                    Prendas de
                  </th>
                  <th className="px-4 py-3 font-semibold text-xs text-slate-500 uppercase tracking-widest">
                    Productos
                  </th>
                  <th className="px-4 py-3 font-semibold text-xs text-slate-500 uppercase tracking-widest">
                    Pago
                  </th>
                  <th className="px-4 py-3 font-semibold text-xs text-slate-500 uppercase tracking-widest text-right">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredSales.map((sale) => {
                  const uniqueOwners = getUniqueOwnersConfigs(sale.displayItems);
                  
                  // Resumen de productos truncado "2x Blusa, 1x Jeans..."
                  let productsSummary = sale.displayItems
                    .map((item) => `${item.quantity}x ${item.product_name}`)
                    .join(", ");
                  if (productsSummary.length > 40) {
                    productsSummary = productsSummary.substring(0, 40) + "...";
                  }

                  return (
                    <tr
                      key={sale.id}
                      onClick={() => setSelectedSale(sale)}
                      className="hover:bg-indigo-50/30 cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-semibold text-slate-700 group-hover:text-indigo-700">
                            #{sale.id.slice(0, 8).toUpperCase()}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">
                            {fmtDate(sale.created_at)}
                          </span>
                          <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-mono">
                            {fmtTime(sale.created_at)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {uniqueOwners.length > 0 ? (
                            uniqueOwners.map((conf) => (
                              <Badge
                                key={conf.key}
                                variant="outline"
                                className="font-medium bg-transparent border-transparent px-0 mr-2"
                                style={{ color: conf.color }}
                              >
                                <span
                                  className="w-2 h-2 rounded-full mr-1.5"
                                  style={{ backgroundColor: conf.color }}
                                />
                                {conf.displayName}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400 italic">Sin especificar</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {productsSummary || (
                          <span className="text-slate-400 italic">
                            Sin items detallados
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-50 text-slate-600 border border-slate-200">
                          {sale.payment_method === "cash"
                            ? "Efectivo"
                            : "Transferencia"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-base font-bold font-mono text-slate-900">
                          ${sale.displayTotal.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
          
          <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-6 shrink-0 mt-auto shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)]">
            <span className="font-semibold text-slate-600 uppercase text-sm tracking-wide">
              Total ({filteredSales.length} tickets)
            </span>
            <span className="font-bold text-xl text-slate-900 font-mono">
              ${totalFilteredAmount.toFixed(2)}
            </span>
          </div>
        </div>
        )}
      </div>

      {/* Drawer Detalle */}
      {selectedSale && (
        <SaleDetailDrawer
          sale={selectedSale}
          onClose={() => setSelectedSale(null)}
          onPrint={() => {
            // Placeholder: Call window.print or generate PDF specific to ticket component
            alert("Función de impresión en desarrollo");
          }}
        />
      )}
    </div>
  );
}
