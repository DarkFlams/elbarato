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
  Wallet,
  TrendingDown,
  TrendingUp,
  Info,
  Receipt,
  Users,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { getPartnerConfig, getPartnerConfigFromPartner } from "@/lib/partners";
import type { Partner, Expense, ExpenseAllocation } from "@/types/database";

interface ExpenseWithAllocations extends Expense {
  expense_allocations: ExpenseAllocation[];
}
import {
  SaleDetailDrawer,
  type SaleDetailData,
} from "@/components/sales/sale-detail-drawer";
import { exportSalesToExcel, exportSalesToPdf, type SaleExportData } from "@/lib/export-utils";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function VentasPage() {
  const [sales, setSales] = useState<SaleDetailData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fromDate, setFromDate] = useState(() => formatDateInput(new Date()));
  const [toDate, setToDate] = useState(() => formatDateInput(new Date()));
  const [activePreset, setActivePreset] = useState<number | null>(1);
  const [selectedSale, setSelectedSale] = useState<SaleDetailData | null>(null);
  const [filterPartner, setFilterPartner] = useState<string | null>(null);

  // Estados nuevos para Liquidación (Cintillo)
  const [partners, setPartners] = useState<Partner[]>([]);
  const [expenses, setExpenses] = useState<ExpenseWithAllocations[]>([]);
  const [showExpensesDrawer, setShowExpensesDrawer] = useState(false);

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

      let expQuery = supabase.from("expenses").select(`
        *,
        expense_allocations (
          partner_id,
          amount
        )
      `).order("created_at", { ascending: false });

      if (fromDate) expQuery = expQuery.gte("created_at", `${fromDate}T00:00:00`);
      if (toDate) expQuery = expQuery.lte("created_at", `${toDate}T23:59:59.999`);
      if (!fromDate && !toDate) expQuery = expQuery.limit(50);

      const [salesRes, expRes, partnersRes] = await Promise.all([
        query,
        expQuery,
        supabase.from("partners").select("*").order("name"),
      ]);

      if (salesRes.error) throw salesRes.error;
      if (expRes.error) throw expRes.error;

      const fetchedPartners = (partnersRes.data || []) as Partner[];
      setPartners(fetchedPartners);
      setExpenses((expRes.data as unknown as ExpenseWithAllocations[]) || []);

      const partnerMap: Record<string, Partner> = {};
      for (const p of fetchedPartners) {
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
    setActivePreset(days);
  };

  const clearFilters = () => {
    setFromDate("");
    setToDate("");
    setActivePreset(null);
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

  const getLiquidationData = () => ({
    totalSales,
    totalExpenses: totalExpensesAmount,
    netIncome,
    partnerName: filterPartner ? getPartnerConfig({ name: filterPartner }).displayName : "Todas las Socias",
    expensesDetail: myExpenses.map(e => ({ description: e.description, amount: e.amount, date: e.date }))
  });

  const handleExportExcel = () => {
    exportSalesToExcel(prepareExportData(), getLiquidationData());
  };

  const handleExportPdf = () => {
    exportSalesToPdf(prepareExportData(), getLiquidationData());
  };

  // ==========================================
  // Liquidación de Gastos (Cintillo)
  // ==========================================
  const selectedPartnerDb = filterPartner 
    ? partners.find((p) => getPartnerConfigFromPartner(p).key === filterPartner)
    : null;

  let totalSales = totalFilteredAmount;
  let myExpenses: Array<{ id: string; description: string; amount: number; scope: string; date: string }> = [];

  if (filterPartner && selectedPartnerDb) {
    expenses.forEach((exp) => {
      const myAlloc = exp.expense_allocations?.find((a) => a.partner_id === selectedPartnerDb.id);
      if (myAlloc && Number(myAlloc.amount) > 0) {
        myExpenses.push({
          id: exp.id,
          description: `${exp.description} (${exp.scope === 'shared' ? 'Compartido' : 'Individual'})`,
          amount: Number(myAlloc.amount),
          scope: exp.scope,
          date: exp.created_at,
        });
      }
    });
  } else {
    expenses.forEach((exp) => {
      myExpenses.push({
        id: exp.id,
        description: `${exp.description} (${exp.scope === 'shared' ? 'Compartido' : 'Individual'})`,
        amount: Number(exp.amount),
        scope: exp.scope,
        date: exp.created_at,
      });
    });
  }

  const totalExpensesAmount = myExpenses.reduce((sum, e) => sum + e.amount, 0);
  const netIncome = totalSales - totalExpensesAmount;

  return (
    <div className="flex flex-col h-full gap-4">
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
                className={`h-8 text-xs transition-colors ${
                  activePreset === preset.days
                    ? "bg-white shadow-sm text-slate-900 font-medium"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => setPresetRange(preset.days)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          <Input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setActivePreset(null);
            }}
            className="w-auto bg-slate-50 border-slate-200"
          />
          <Input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setActivePreset(null);
            }}
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

          <span className="text-xs text-slate-400 ml-auto font-medium">
            {filteredSales.length} ticket{filteredSales.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Cintillo de Liquidación */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2 shrink-0">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Total Ventas</p>
              <h3 className="text-2xl font-bold text-slate-900">${totalSales.toFixed(2)}</h3>
            </div>
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
               <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          
          <button 
            onClick={() => setShowExpensesDrawer(true)}
            className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between relative group hover:border-red-200 transition-colors text-left"
          >
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1 flex items-center gap-1">
                Gastos a Deducir <Info className="h-3.5 w-3.5 text-slate-400 group-hover:text-red-400 transition-colors" />
              </p>
              <h3 className="text-2xl font-bold text-red-600">-${totalExpensesAmount.toFixed(2)}</h3>
            </div>
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
               <TrendingDown className="h-5 w-5" />
            </div>
            <div className="absolute inset-0 bg-red-50/0 group-hover:bg-red-50/50 transition-colors rounded-xl pointer-events-none" />
          </button>

          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500 mb-1">Liquidación Neta</p>
              <h3 className="text-2xl font-bold text-slate-900">${netIncome.toFixed(2)}</h3>
            </div>
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-700">
               <Wallet className="h-5 w-5" />
            </div>
          </div>
        </div>
      )}

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

      {/* Drawer Metadatos de Gastos */}
      <Dialog open={showExpensesDrawer} onOpenChange={setShowExpensesDrawer}>
        <DialogContent className="sm:max-w-md max-h-[85vh] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <Receipt className="h-5 w-5 text-red-500" />
              Desglose de Gastos
            </DialogTitle>
            <DialogDescription className="text-slate-500 mt-1">
              {filterPartner 
                ? `Gastos compartidos e individuales descontados de las ventas de ${getPartnerConfig({ name: filterPartner }).displayName}.`
                : "Listado de todos los gastos que reducen el neto total del día."}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1 px-6 pb-6">
            {myExpenses.length === 0 ? (
              <div className="text-center py-8 text-slate-400 flex flex-col items-center gap-2">
                <Receipt className="h-10 w-10 opacity-20" />
                <p>No se han registrado gastos para mostrar.</p>
              </div>
            ) : (
              <div className="space-y-3 mt-4">
                {myExpenses.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${exp.scope === 'shared' ? 'bg-indigo-100 text-indigo-700' : 'bg-violet-100 text-violet-700'}`}>
                        {exp.scope === 'shared' ? <Users className="h-4 w-4" /> : <User className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">{exp.description}</p>
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {fmtTime(exp.date)}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono font-bold text-red-600">
                      -${exp.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
