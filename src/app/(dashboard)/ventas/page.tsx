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
import {
  getPartnerConfig,
  getPartnerConfigFromPartner,
  sortPartnersByBusinessOrder,
} from "@/lib/partners";
import type { Partner, Expense, ExpenseAllocation } from "@/types/database";
import {
  getCashSessionReportLocalFirst,
  getCashSessionsHistoryLocalFirst,
  getExpensesBySessionLocalFirst,
  getSalesHistoryLocalFirst,
} from "@/lib/local/history";
import {
  formatEcuadorDate,
  formatEcuadorTime,
  toEcuadorDateInput,
} from "@/lib/timezone-ecuador";

interface ExpenseWithAllocations extends Expense {
  expense_allocations: ExpenseAllocation[];
}

interface VentasPageViewState {
  fromDate: string;
  toDate: string;
  activePreset: number | null;
  selectedIndex: number | null;
  filterPartner: string | null;
}

const VENTAS_PAGE_VIEW_STATE_KEY = "dashboard:ventas:page:v1";

import type { SaleDetailData } from "@/components/sales/sale-detail-drawer";
import { exportSalesToExcel, exportSalesToPdf, type SaleExportData } from "@/lib/export-utils";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function VentasPage() {
  const [sales, setSales] = useState<SaleDetailData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fromDate, setFromDate] = useState(() => toEcuadorDateInput(new Date()));
  const [toDate, setToDate] = useState(() => toEcuadorDateInput(new Date()));
  const [activePreset, setActivePreset] = useState<number | null>(1);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [filterPartner, setFilterPartner] = useState<string | null>(null);
  const [viewStateRestored, setViewStateRestored] = useState(false);
  const [showCustomDates, setShowCustomDates] = useState(false);

  // Estados nuevos para Liquidación (Cintillo)
  const [partners, setPartners] = useState<Partner[]>([]);
  const [expenses, setExpenses] = useState<ExpenseWithAllocations[]>([]);
  const [showExpensesDrawer, setShowExpensesDrawer] = useState(false);
  const filterPartnerKeys = ["rosa", "lorena", "yadira", "todos"] as const;

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.sessionStorage.getItem(VENTAS_PAGE_VIEW_STATE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<VentasPageViewState>;

      if (typeof parsed.fromDate === "string") {
        setFromDate(parsed.fromDate);
      }

      if (typeof parsed.toDate === "string") {
        setToDate(parsed.toDate);
      }

      if (
        (typeof parsed.activePreset === "number" &&
          Number.isInteger(parsed.activePreset) &&
          parsed.activePreset > 0) ||
        parsed.activePreset === null
      ) {
        setActivePreset(parsed.activePreset);
      }

      if (
        (typeof parsed.selectedIndex === "number" &&
          Number.isInteger(parsed.selectedIndex) &&
          parsed.selectedIndex >= 0) ||
        parsed.selectedIndex === null
      ) {
        setSelectedIndex(parsed.selectedIndex);
      }

      if (typeof parsed.filterPartner === "string" || parsed.filterPartner === null) {
        setFilterPartner(parsed.filterPartner);
      }
    } catch (error) {
      console.error("[VentasPage] state restore error:", error);
    } finally {
      setViewStateRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!viewStateRestored || typeof window === "undefined") return;

    const viewState: VentasPageViewState = {
      fromDate,
      toDate,
      activePreset,
      selectedIndex,
      filterPartner,
    };

    try {
      window.sessionStorage.setItem(
        VENTAS_PAGE_VIEW_STATE_KEY,
        JSON.stringify(viewState)
      );
    } catch (error) {
      console.error("[VentasPage] state persist error:", error);
    }
  }, [viewStateRestored, fromDate, toDate, activePreset, selectedIndex, filterPartner]);

  const fetchSales = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fetchedSales, fetchedSessions] = await Promise.all([
        getSalesHistoryLocalFirst(fromDate || undefined, toDate || undefined),
        getCashSessionsHistoryLocalFirst(fromDate || undefined, toDate || undefined),
      ]);

      setSales(fetchedSales);

      const sessionIds = fetchedSessions.map((session) => session.id);
      const reportsBySession = await Promise.all(
        sessionIds.map((sessionId) => getCashSessionReportLocalFirst(sessionId))
      );

      const fetchedPartnersMap = new Map<string, Partner>();
      reportsBySession.flat().forEach((reportRow) => {
        const partner: Partner = {
          id: reportRow.partner_id,
          name: reportRow.partner,
          display_name: reportRow.display_name,
          color_hex: reportRow.color_hex,
          is_expense_eligible: true,
          created_at: reportRow.opened_at,
        };
        fetchedPartnersMap.set(partner.id, partner);
        fetchedPartnersMap.set(partner.name, partner);
      });

      const fetchedExpenses = await Promise.all(
        sessionIds.map((sessionId) => getExpensesBySessionLocalFirst(sessionId))
      );

      const uniquePartners = Array.from(fetchedPartnersMap.values()).filter(
        (value, index, array) => array.findIndex((current) => current.id === value.id) === index
      );
      setPartners(sortPartnersByBusinessOrder(uniquePartners));
      setExpenses(fetchedExpenses.flat() as unknown as ExpenseWithAllocations[]);
    } catch (err) {
      console.error("[VentasPage] fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    if (!viewStateRestored) return;
    void fetchSales();
  }, [fetchSales, viewStateRestored]);

  const setPresetRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setFromDate(toEcuadorDateInput(start));
    setToDate(toEcuadorDateInput(end));
    setActivePreset(days);
  };

  const hasFilters = Boolean(fromDate || toDate);

  const fmtDate = (d: string) =>
    formatEcuadorDate(d, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const fmtTime = (d: string) =>
    formatEcuadorTime(d, {
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

  useEffect(() => {
    if (selectedIndex === null) return;

    if (filteredSales.length === 0) {
      setSelectedIndex(null);
      return;
    }

    if (selectedIndex >= filteredSales.length) {
      setSelectedIndex(filteredSales.length - 1);
    }
  }, [filteredSales.length, selectedIndex]);

  const totalFilteredAmount = filteredSales.reduce((sum, s) => sum + s.displayTotal, 0);

  // ==========================================
  // Navegación por teclado
  // ==========================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorar si estamos escribiendo en un input
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); // Evitar scroll de la página

        if (filteredSales.length === 0) return;

        setSelectedIndex((prev) => {
          if (prev === null) return 0;
          if (e.key === "ArrowDown") {
            return Math.min(prev + 1, filteredSales.length - 1);
          } else {
            return Math.max(prev - 1, 0);
          }
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredSales]);

  // Auto-scroll a la fila seleccionada
  useEffect(() => {
    if (selectedIndex !== null) {
      const row = document.getElementById(`sale-row-${selectedIndex}`);
      if (row) {
        row.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    }
  }, [selectedIndex]);

  const getUniqueOwnersConfigs = (items: typeof sales[0]['sale_items']) => {
    const map = new Map<string, ReturnType<typeof getPartnerConfig>>();
    items.forEach(item => {
      // item.partner en sale_items suele ser el nombre en string, no un objeto
      const partnerName =
        typeof item.partner === "string"
          ? item.partner
          : typeof item.partner === "object" &&
              item.partner !== null &&
              "name" in item.partner &&
              typeof item.partner.name === "string"
            ? item.partner.name
            : "";
      const conf = getPartnerConfig({ name: partnerName });
      
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

  const totalSales = totalFilteredAmount;
  const myExpenses: Array<{
    id: string;
    description: string;
    amount: number;
    scope: string;
    date: string;
  }> = (() => {
    const rows: Array<{
      id: string;
      description: string;
      amount: number;
      scope: string;
      date: string;
    }> = [];

    if (filterPartner && selectedPartnerDb) {
      expenses.forEach((exp) => {
        const myAlloc = exp.expense_allocations?.find(
          (a) => a.partner_id === selectedPartnerDb.id
        );
        if (myAlloc && Number(myAlloc.amount) > 0) {
          rows.push({
            id: exp.id,
            description: `${exp.description} (${exp.scope === "shared" ? "Compartido" : "Individual"})`,
            amount: Number(myAlloc.amount),
            scope: exp.scope,
            date: exp.created_at,
          });
        }
      });
      return rows;
    }

    expenses.forEach((exp) => {
      rows.push({
        id: exp.id,
        description: `${exp.description} (${exp.scope === "shared" ? "Compartido" : "Individual"})`,
        amount: Number(exp.amount),
        scope: exp.scope,
        date: exp.created_at,
      });
    });
    return rows;
  })();

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
          {filterPartnerKeys.map((key) => {
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
        <div className="flex flex-wrap items-center gap-2">
          {!showCustomDates ? (
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
              <div className="w-px h-6 bg-slate-200 mx-1" />
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 text-xs text-slate-600 hover:text-slate-900 transition-colors ${
                  activePreset === null ? "bg-white shadow-sm font-medium text-slate-900" : ""
                }`}
                onClick={() => setShowCustomDates(true)}
              >
                Personalizado
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-200 h-10 px-2 animate-in fade-in slide-in-from-right-4 duration-200">
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setActivePreset(null);
                }}
                className="w-auto h-8 bg-transparent border-0 shadow-none text-xs px-2 focus-visible:ring-0"
              />
              <span className="text-slate-300">-</span>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setActivePreset(null);
                }}
                className="w-auto h-8 bg-transparent border-0 shadow-none text-xs px-2 focus-visible:ring-0"
              />
              <Button
                variant="ghost"
                size="icon"
                title="Cerrar fechas"
                className="h-6 w-6 text-slate-400 hover:text-slate-900 hover:bg-slate-200 ml-1 rounded-md"
                onClick={() => {
                  setShowCustomDates(false);
                  if (activePreset === null && fromDate === "Hoy") {
                    setPresetRange(1);
                  }
                }}
              >
                <FilterX className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {(activePreset === null || filterPartner !== null) && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-slate-500 hover:text-slate-900 bg-white"
              onClick={() => {
                setPresetRange(1);
                setFilterPartner(null);
                setShowCustomDates(false);
              }}
              title="Restablecer filtros"
            >
              <FilterX className="h-4 w-4 mr-1.5" />
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {/* Cintillo de Liquidación */}
      {false && !isLoading && (
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
                  <th className="w-24 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Orden #</th>
                  <th className="w-28 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Fecha</th>
                  <th className="w-16 px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Hora</th>
                  <th className="w-12 px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">Cant.</th>
                  <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Productos</th>
                  <th className="w-24 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Pago</th>
                  <th className="w-24 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Total</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {filteredSales.map((sale, index) => {
                  const uniqueOwners = getUniqueOwnersConfigs(sale.displayItems);
                  const totalItems = sale.displayItems.reduce((sum, item) => sum + item.quantity, 0);
                  
                  // Resumen de productos sin el prefijo de cantidad
                  let productsSummary = sale.displayItems
                    .map((item) => item.product_name)
                    .join(", ");
                  if (productsSummary.length > 50) {
                    productsSummary = productsSummary.substring(0, 50) + "...";
                  }

                  // Construir gradiente multicolor para la barra lateral
                  const ownerColors = uniqueOwners.length > 0
                    ? uniqueOwners.map((c) => c.color)
                    : ["#cbd5e1"]; // slate-300 fallback
                  const barStyle: React.CSSProperties = ownerColors.length === 1
                    ? { backgroundColor: ownerColors[0] }
                    : {
                        background: `linear-gradient(to bottom, ${ownerColors
                          .map((c, i) => {
                            const start = (i / ownerColors.length) * 100;
                            const end = ((i + 1) / ownerColors.length) * 100;
                            return `${c} ${start}%, ${c} ${end}%`;
                          })
                          .join(", ")})`,
                      };

                  const isSelected = index === selectedIndex;

                  return (
                    <tr
                      id={`sale-row-${index}`}
                      key={sale.id}
                      onClick={() => setSelectedIndex(index)}
                      className={`group transition-colors border-b border-slate-100/60 cursor-pointer ${
                        isSelected ? "bg-indigo-50/60" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-4 py-1.5 align-middle relative">
                        {/* Barra vertical sutil (2px) como en carrito */}
                        <div
                          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-md"
                          style={barStyle}
                        />
                        <span className="block font-mono text-[11px] font-medium text-slate-800 uppercase group-hover:text-amber-700 transition-colors ml-1">
                          #{sale.id.slice(0, 8)}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 align-middle">
                        <span className="text-[11px] font-medium text-slate-900 leading-tight block">
                          {fmtDate(sale.created_at)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                          {fmtTime(sale.created_at)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center align-middle">
                        <span className="block font-mono text-[13px] font-bold text-slate-900">
                          {totalItems}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 align-middle">
                        <span className="text-[11px] text-slate-600 truncate block max-w-[250px]" title={sale.displayItems.map((item) => `${item.quantity}x ${item.product_name}`).join(", ")}>
                          {productsSummary || <span className="text-[10px] text-slate-300 italic">-</span>}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 align-middle">
                        <span className="text-[10px] font-semibold uppercase tracking-tighter text-slate-500">
                          {sale.payment_method === "cash" ? "Efectivo" : "Transfer."}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-right align-middle">
                        <span className="font-mono text-[13px] font-bold tabular-nums text-slate-900">
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

      {!isLoading && (
        <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Total Ventas
              </p>
              <h3 className="mt-1 font-mono text-[1.9rem] font-bold leading-none text-slate-900">
                ${totalSales.toFixed(2)}
              </h3>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>

          <button
            onClick={() => setShowExpensesDrawer(true)}
            className="group relative flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-red-200"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Gastos a Deducir
                <Info className="h-3.5 w-3.5 text-slate-400 transition-colors group-hover:text-red-400" />
              </p>
              <h3 className="mt-1 font-mono text-[1.9rem] font-bold leading-none text-red-600">
                -${totalExpensesAmount.toFixed(2)}
              </h3>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
              <TrendingDown className="h-4 w-4" />
            </div>
            <div className="pointer-events-none absolute inset-0 rounded-lg bg-red-50/0 transition-colors group-hover:bg-red-50/50" />
          </button>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Liquidación Neta
              </p>
              <h3 className="mt-1 font-mono text-[1.9rem] font-bold leading-none text-slate-900">
                ${netIncome.toFixed(2)}
              </h3>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
        </div>
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
