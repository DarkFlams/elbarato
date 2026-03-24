/**
 * @file ventas/page.tsx
 * @description Lista Profesional de Ventas (SaaS Style).
 *              Tabla plana limpia sin accordions, con drawer detalle.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ShoppingBag,
  FilterX,
  Clock,
  Loader2,
  ReceiptText,
  Download,
  Wallet,
  TrendingDown,
  TrendingUp,
  Info,
  Receipt,
  Users,
  User,
  LayoutGrid,
  CalendarDays,
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
  expense_allocations: Array<
    ExpenseAllocation & {
      partner?: Partner | null;
    }
  >;
}

interface VentasPageViewState {
  fromDate: string;
  toDate: string;
  activePreset: number | null;
  selectedIndex: number | null;
  filterPartner: string | null;
}

const VENTAS_PAGE_VIEW_STATE_KEY = "dashboard:ventas:page:v1";

function parseDateInputParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function shiftDateInput(value: string, deltaDays: number) {
  const anchor = new Date(`${value}T12:00:00-05:00`);
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  return toEcuadorDateInput(anchor.toISOString());
}

function toSafeFilenamePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

import type { SaleDetailData } from "@/components/sales/sale-detail-drawer";
import { exportConsolidatedPdf, exportConsolidatedExcel, type ConsolidatedDayData } from "@/lib/export-utils";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useCartStore } from "@/hooks/use-cart";
import { getCatalogProductsByIds } from "@/lib/local/catalog";
import { voidSaleLocalFirst } from "@/lib/local/sales";
import type { CartItem, PriceTier } from "@/types/database";

type SaleActionMode = "void" | "void-and-copy";

export default function VentasPage() {
  const router = useRouter();
  const openTabWithDraft = useCartStore((state) => state.openTabWithDraft);
  const [sales, setSales] = useState<SaleDetailData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fromDate, setFromDate] = useState(() => toEcuadorDateInput(new Date()));
  const [toDate, setToDate] = useState(() => toEcuadorDateInput(new Date()));
  const [activePreset, setActivePreset] = useState<number | null>(1);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [filterPartner, setFilterPartner] = useState<string | null>(null);
  const [viewStateRestored, setViewStateRestored] = useState(false);
  const [showCustomDates, setShowCustomDates] = useState(false);
  const [pendingSaleAction, setPendingSaleAction] = useState<SaleActionMode | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [isSubmittingSaleAction, setIsSubmittingSaleAction] = useState(false);

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

  const selectedSale =
    selectedIndex === null ? null : (filteredSales[selectedIndex] ?? null);
  const activeFilteredSales = filteredSales.filter((sale) => sale.status !== "voided");
  const totalFilteredAmount = activeFilteredSales.reduce(
    (sum, sale) => sum + sale.displayTotal,
    0
  );

  const closeSaleActionDialog = () => {
    if (isSubmittingSaleAction) return;
    setPendingSaleAction(null);
    setVoidReason("");
  };

  const openSaleActionDialog = (mode: SaleActionMode) => {
    if (!selectedSale || selectedSale.status === "voided") return;

    setPendingSaleAction(mode);
    setVoidReason(
      mode === "void-and-copy" ? "Correccion de ticket" : "Anulacion manual"
    );
  };

  const buildReplacementDraftItems = async (sale: SaleDetailData) => {
    const sourceItems = sale.sale_items;
    const productIds = sourceItems.map((item) => item.product_id).filter(Boolean);
    const catalogProducts = await getCatalogProductsByIds(productIds);
    const productsById = new Map(catalogProducts.map((product) => [product.id, product]));
    const restoredQuantities = new Map<string, number>();

    for (const item of sourceItems) {
      restoredQuantities.set(
        item.product_id,
        (restoredQuantities.get(item.product_id) ?? 0) + item.quantity
      );
    }

    const missingProducts: string[] = [];
    const inactiveProducts: string[] = [];

    const draftItems = sourceItems.reduce<CartItem[]>((acc, item) => {
      const product = productsById.get(item.product_id);
      if (!product) {
        missingProducts.push(item.product_name);
        return acc;
      }

      if (!product.is_active) {
        inactiveProducts.push(product.name);
        return acc;
      }

      const tier = (item.price_tier ?? "normal") as PriceTier;
      acc.push({
        id:
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        product_id: product.id,
        barcode: product.barcode,
        sku: product.sku,
        name: product.name,
        owner_id: product.owner_id,
        owner_name: product.owner.name,
        owner_display_name: product.owner.display_name,
        owner_color: product.owner.color_hex,
        available_stock:
          Number(product.stock ?? 0) + (restoredQuantities.get(item.product_id) ?? 0),
        sale_price: product.sale_price,
        sale_price_x3: product.sale_price_x3,
        sale_price_x6: product.sale_price_x6,
        sale_price_x12: product.sale_price_x12,
        unit_price: item.unit_price,
        price_tier: tier,
        price_override: item.unit_price,
        quantity: item.quantity,
        subtotal: item.subtotal,
      });
      return acc;
    }, []);

    if (missingProducts.length > 0) {
      throw new Error(
        `No se pudo preparar la copia. Faltan productos actuales: ${missingProducts.join(", ")}`
      );
    }

    if (inactiveProducts.length > 0) {
      throw new Error(
        `No se pudo preparar la copia. Hay productos inactivos: ${inactiveProducts.join(", ")}`
      );
    }

    if (draftItems.length === 0) {
      throw new Error("El ticket no tiene items validos para copiar");
    }

    return draftItems;
  };

  const handleConfirmSaleAction = async () => {
    if (!selectedSale || !pendingSaleAction) return;

    const trimmedReason = voidReason.trim();
    if (!trimmedReason) {
      toast.error("Debes indicar el motivo de la anulacion");
      return;
    }

    setIsSubmittingSaleAction(true);

    try {
      const replacementDraftItems =
        pendingSaleAction === "void-and-copy"
          ? await buildReplacementDraftItems(selectedSale)
          : null;

      const result = await voidSaleLocalFirst({
        saleId: selectedSale.id,
        reason: trimmedReason,
      });

      if (pendingSaleAction === "void-and-copy" && replacementDraftItems) {
        openTabWithDraft({
          items: replacementDraftItems,
          paymentMethod:
            selectedSale.payment_method === "cash" ||
            selectedSale.payment_method === "transfer"
              ? selectedSale.payment_method
              : null,
          notes: `Correccion de ticket #${selectedSale.id.slice(0, 8).toUpperCase()}`,
        });

        toast.success("Ticket anulado y copiado", {
          description:
            result.mode === "local"
              ? "Se abrio una nueva venta para corregir el ticket."
              : "La copia editable ya esta lista en Punto de Venta.",
        });

        closeSaleActionDialog();
        router.push("/caja");
        await fetchSales();
        return;
      }

      toast.success("Ticket anulado", {
        description: "El ticket quedo marcado como anulado y el stock fue restaurado.",
      });
      closeSaleActionDialog();
      await fetchSales();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo anular el ticket";
      toast.error("Error al anular ticket", { description: message });
      console.error("[VentasPage] handleConfirmSaleAction error:", error);
    } finally {
      setIsSubmittingSaleAction(false);
    }
  };

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

  // ==========================================
  // Resumen Consolidado: datos + exportación
  // ==========================================
  const [resumenPopover, setResumenPopover] = useState<"pdf" | "excel" | null>(null);
  const [resumenCustomFrom, setResumenCustomFrom] = useState("");
  const [resumenCustomTo, setResumenCustomTo] = useState("");
  const resumenDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!resumenPopover) return;
    const handler = (e: MouseEvent) => {
      if (resumenDropdownRef.current && !resumenDropdownRef.current.contains(e.target as Node)) {
        setResumenPopover(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [resumenPopover]);

  const buildConsolidatedDays = (
    sourceSales: SaleDetailData[],
    sourceExpenses: ExpenseWithAllocations[],
    rangeFrom: string,
    rangeTo: string
  ) => {
    const dayMap = new Map<string, ConsolidatedDayData>();
    for (const sale of sourceSales) {
      if (sale.status === "voided") continue;
      const datePart = toEcuadorDateInput(sale.created_at);
      if (datePart < rangeFrom || datePart > rangeTo) continue;
      // Filtrar items por socia si hay filtro activo
      const items = filterPartner
        ? sale.sale_items.filter(item => getPartnerConfigFromPartner(item.partner).key === filterPartner)
        : sale.sale_items;
      if (items.length === 0) continue;
      if (!dayMap.has(datePart)) {
        const d = new Date(datePart + "T12:00:00-05:00");
        const label = formatEcuadorDate(d.toISOString(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        dayMap.set(datePart, { dateLabel: label, products: [], expenses: [], totalSales: 0, totalExpenses: 0 });
      }
      const day = dayMap.get(datePart)!;
      for (const item of items) {
        const pName = item.product_name || "Desconocido";
        let existing = day.products.find((p) => p.productName === pName);
        if (!existing) { existing = { productName: pName, quantity: 0, total: 0 }; day.products.push(existing); }
        existing.quantity += item.quantity;
        existing.total += item.subtotal;
        day.totalSales += item.subtotal;
      }
    }

    for (const exp of sourceExpenses) {
      const datePart = toEcuadorDateInput(exp.created_at);
      if (datePart < rangeFrom || datePart > rangeTo) continue;

      const expenseAmount = filterPartner
        ? exp.expense_allocations
            ?.filter(
              (allocation) =>
                allocation.partner &&
                getPartnerConfigFromPartner(allocation.partner).key === filterPartner
            )
            .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0) ?? 0
        : Number(exp.amount || 0);

      if (expenseAmount <= 0) continue;

      if (!dayMap.has(datePart)) {
        const d = new Date(datePart + "T12:00:00-05:00");
        const label = formatEcuadorDate(d.toISOString(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        dayMap.set(datePart, { dateLabel: label, products: [], expenses: [], totalSales: 0, totalExpenses: 0 });
      }
      const day = dayMap.get(datePart)!;
      day.expenses.push({ description: exp.description, amount: expenseAmount });
      day.totalExpenses += expenseAmount;
    }
    return Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  };

  const getDateRange = (preset: "hoy" | "semana" | "mes" | "custom"): [string, string] => {
    const todayStr = toEcuadorDateInput(new Date());
    if (preset === "hoy") return [todayStr, todayStr];

    if (preset === "semana") {
      const anchor = new Date(`${todayStr}T12:00:00-05:00`);
      const dayOfWeek = anchor.getUTCDay(); // 0=sun
      const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const mon = shiftDateInput(todayStr, diffToMon);
      const sun = shiftDateInput(mon, 6);
      return [mon, sun];
    }

    if (preset === "mes") {
      const parts = parseDateInputParts(todayStr);
      if (!parts) return [todayStr, todayStr];
      const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
      return [
        `${parts.year}-${String(parts.month).padStart(2, "0")}-01`,
        `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      ];
    }

    return [resumenCustomFrom, resumenCustomTo || resumenCustomFrom];
  };

  const triggerResumenDownload = async (preset: "hoy" | "semana" | "mes" | "custom") => {
    const [rf, rt] = getDateRange(preset);
    if (!rf || !rt) {
      toast.error("Selecciona una fecha valida para descargar");
      return;
    }

    if (rf > rt) {
      toast.error("La fecha inicial no puede ser mayor que la fecha final");
      return;
    }

    try {
      const [rangeSales, rangeSessions] = await Promise.all([
        getSalesHistoryLocalFirst(rf, rt),
        getCashSessionsHistoryLocalFirst(rf, rt),
      ]);

      const expensesBySession = await Promise.all(
        rangeSessions.map((session) => getExpensesBySessionLocalFirst(session.id))
      );

      const uniqueExpenses = Array.from(
        new Map(
          expensesBySession
            .flat()
            .map((expense) => [expense.id, expense as ExpenseWithAllocations])
        ).values()
      );

      const sortedDays = buildConsolidatedDays(rangeSales, uniqueExpenses, rf, rt);
      if (sortedDays.length === 0) {
        toast.error("No hay tickets para el rango seleccionado");
        return;
      }

      const partnerLabel = filterPartner
        ? getPartnerConfig({ name: filterPartner }).displayName
        : "TOTAL";
      const dateRange = rf === rt ? rf : `${rf} a ${rt}`;
      const partnerFileLabel =
        filterPartner && partnerLabel.trim().length > 0 ? partnerLabel : "todas";
      const rangeFileLabel = rf === rt ? rf : `${rf}_a_${rt}`;
      const filenameBase = `resumen_${toSafeFilenamePart(partnerFileLabel)}_${rangeFileLabel}`;

      if (resumenPopover === "pdf") {
        exportConsolidatedPdf(sortedDays, dateRange, partnerLabel, `${filenameBase}.pdf`);
      } else {
        await exportConsolidatedExcel(sortedDays, partnerLabel, `${filenameBase}.xlsx`);
      }

      setResumenPopover(null);
    } catch (error) {
      console.error("[VentasPage] resumen download error:", error);
      toast.error("No se pudo descargar el resumen para ese rango");
    }
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
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
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

        <div ref={resumenDropdownRef} className="relative flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { if (resumenPopover === "pdf") { setResumenPopover(null); } else { setResumenCustomFrom(""); setResumenCustomTo(""); setResumenPopover("pdf"); } }} className="h-9 hover:bg-slate-100 border-slate-300 text-slate-700 transition-colors">
              <LayoutGrid className="h-4 w-4 mr-2" />
              Resumen A4
            </Button>
            <Button variant="outline" size="sm" onClick={() => { if (resumenPopover === "excel") { setResumenPopover(null); } else { setResumenCustomFrom(""); setResumenCustomTo(""); setResumenPopover("excel"); } }} className="h-9 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition-colors">
              <Download className="h-4 w-4 mr-2" />
              Resumen Excel
            </Button>
          </div>
          {resumenPopover && (
            <div className="absolute right-0 top-full mt-2 z-[100] w-72 p-3 rounded-lg bg-white shadow-lg ring-1 ring-black/10 overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150">
              <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                {resumenPopover === "pdf" ? "Descargar PDF" : "Descargar Excel"} — Rango
              </p>
              <div className="flex flex-col gap-1">
                {(["hoy", "semana", "mes"] as const).map((p) => (
                  <button key={p} onClick={() => triggerResumenDownload(p)} className="w-full text-left px-3 py-1.5 text-sm rounded-md hover:bg-slate-100 transition-colors">
                    {p === "hoy" ? "Hoy" : p === "semana" ? "Esta semana (Lun–Dom)" : "Este mes"}
                  </button>
                ))}
                <div className="border-t my-1" />
                <p className="text-xs text-slate-400 px-3">Personalizado</p>
                <div className="flex gap-2 px-3">
                  <input type="date" value={resumenCustomFrom} onChange={(e) => setResumenCustomFrom(e.target.value)} className="flex-1 min-w-0 border rounded px-1.5 py-1 text-xs bg-white" />
                  <input type="date" value={resumenCustomTo} onChange={(e) => setResumenCustomTo(e.target.value)} placeholder="Opcional" className="flex-1 min-w-0 border rounded px-1.5 py-1 text-xs bg-white" />
                </div>
                <button onClick={() => triggerResumenDownload("custom")} disabled={!resumenCustomFrom} className="mx-3 mt-1 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Descargar
                </button>
              </div>
            </div>
          )}
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
          <div className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div className="min-w-full">
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
                  const isVoided = sale.status === "voided";
                  const rowTitle = isVoided && sale.void_reason
                    ? `Ticket anulado: ${sale.void_reason}`
                    : undefined;

                  return (
                    <tr
                      id={`sale-row-${index}`}
                      key={sale.id}
                      onClick={() => setSelectedIndex(index)}
                      title={rowTitle}
                      className={`group transition-colors border-b border-slate-100/60 cursor-pointer ${
                        isVoided
                          ? isSelected
                            ? "bg-rose-50"
                            : "bg-rose-50/50 hover:bg-rose-50/70"
                          : isSelected
                            ? "bg-indigo-50/60"
                            : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-4 py-1.5 align-middle relative">
                        {/* Barra vertical sutil (2px) como en carrito */}
                        <div
                          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-md"
                          style={barStyle}
                        />
                        <span
                          className={`ml-1 block font-mono text-[11px] font-medium uppercase transition-colors ${
                            isVoided
                              ? "text-rose-700 line-through decoration-rose-400"
                              : "text-slate-800 group-hover:text-amber-700"
                          }`}
                        >
                          #{sale.id.slice(0, 8)}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 align-middle">
                        <span
                          className={`block text-[11px] font-medium leading-tight ${
                            isVoided
                              ? "text-rose-700 line-through decoration-rose-400"
                              : "text-slate-900"
                          }`}
                        >
                          {fmtDate(sale.created_at)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <span
                          className={`font-mono text-[11px] tabular-nums ${
                            isVoided
                              ? "text-rose-500 line-through decoration-rose-300"
                              : "text-slate-500"
                          }`}
                        >
                          {fmtTime(sale.created_at)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center align-middle">
                        <span
                          className={`block font-mono text-[13px] font-bold ${
                            isVoided
                              ? "text-rose-700 line-through decoration-rose-400"
                              : "text-slate-900"
                          }`}
                        >
                          {totalItems}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 align-middle">
                        <div className="flex items-center gap-2">
                          <span
                            className={`block max-w-[250px] truncate text-[11px] ${
                              isVoided
                                ? "text-rose-600 line-through decoration-rose-300"
                                : "text-slate-600"
                            }`}
                            title={sale.displayItems.map((item) => `${item.quantity}x ${item.product_name}`).join(", ")}
                          >
                          {productsSummary || <span className="text-[10px] text-slate-300 italic">-</span>}
                          </span>
                          {isVoided ? (
                            <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-rose-700">
                              Anulado
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-1.5 align-middle">
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-tighter ${
                            isVoided
                              ? "text-rose-500 line-through decoration-rose-300"
                              : "text-slate-500"
                          }`}
                        >
                          {sale.payment_method === "cash" ? "Efectivo" : "Transfer."}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-right align-middle">
                        <span
                          className={`font-mono text-[13px] font-bold tabular-nums ${
                            isVoided
                              ? "text-rose-700 line-through decoration-rose-400"
                              : "text-slate-900"
                          }`}
                        >
                          ${sale.displayTotal.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </ScrollArea>
          
          <div className="sticky bottom-0 z-10 mt-auto flex shrink-0 items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-6 py-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 disabled:border-slate-200 disabled:text-slate-400"
                disabled={!selectedSale || selectedSale.status === "voided" || isSubmittingSaleAction}
                onClick={() => openSaleActionDialog("void")}
              >
                Anular ticket
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-amber-200 text-amber-800 hover:bg-amber-50 hover:text-amber-900 disabled:border-slate-200 disabled:text-slate-400"
                disabled={!selectedSale || selectedSale.status === "voided" || isSubmittingSaleAction}
                onClick={() => openSaleActionDialog("void-and-copy")}
              >
                Anular y copiar
              </Button>
              <span className="text-xs text-slate-400">
                {selectedSale
                  ? selectedSale.status === "voided"
                    ? "El ticket seleccionado ya esta anulado."
                    : `Ticket #${selectedSale.id.slice(0, 8).toUpperCase()} seleccionado.`
                  : "Selecciona un ticket para anularlo o corregirlo."}
              </span>
            </div>

            <div className="flex items-center gap-6">
              <span className="font-semibold text-slate-600 uppercase text-sm tracking-wide">
                Total ({activeFilteredSales.length} tickets vigentes)
              </span>
              <span className="font-bold text-xl text-slate-900 font-mono">
                ${totalFilteredAmount.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
        )}
      </div>

      {!isLoading && (
        <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Total Ventas
              </p>
              <h3 className="mt-1 font-mono text-[1.45rem] font-semibold leading-none text-slate-800">
                ${totalSales.toFixed(2)}
              </h3>
            </div>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
          </div>

          <button
            onClick={() => setShowExpensesDrawer(true)}
            className="group relative flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-2.5 text-left transition-colors hover:border-slate-300"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Gastos a Deducir
                <Info className="h-3.5 w-3.5 text-slate-400 transition-colors group-hover:text-slate-500" />
              </p>
              <h3 className="mt-1 font-mono text-[1.45rem] font-semibold leading-none text-rose-600">
                -${totalExpensesAmount.toFixed(2)}
              </h3>
            </div>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500">
              <TrendingDown className="h-3.5 w-3.5" />
            </div>
            <div className="pointer-events-none absolute inset-0 rounded-lg bg-slate-100/0 transition-colors group-hover:bg-slate-100/60" />
          </button>

          <div className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/70 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Liquidación Neta
              </p>
              <h3 className="mt-1 font-mono text-[1.45rem] font-semibold leading-none text-slate-800">
                ${netIncome.toFixed(2)}
              </h3>
            </div>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-slate-500">
              <Wallet className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={pendingSaleAction !== null}
        onOpenChange={(open) => {
          if (!open) closeSaleActionDialog();
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!isSubmittingSaleAction}>
          <DialogHeader>
            <DialogTitle>
              {pendingSaleAction === "void-and-copy"
                ? "Anular y copiar ticket"
                : "Anular ticket"}
            </DialogTitle>
            <DialogDescription>
              {pendingSaleAction === "void-and-copy"
                ? "El ticket actual quedara anulado y se abrira una nueva venta editable con los mismos productos."
                : "El ticket quedara anulado, seguira visible en el historial y el stock sera restaurado."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {selectedSale ? (
                <>
                  <span className="font-semibold text-slate-900">
                    Ticket #{selectedSale.id.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="mx-2 text-slate-300">•</span>
                  <span>{fmtDate(selectedSale.created_at)}</span>
                  <span className="mx-2 text-slate-300">•</span>
                  <span className="font-mono">${selectedSale.total.toFixed(2)}</span>
                </>
              ) : (
                "Sin ticket seleccionado"
              )}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="void-reason"
                className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Motivo
              </label>
              <Textarea
                id="void-reason"
                value={voidReason}
                onChange={(event) => setVoidReason(event.target.value)}
                placeholder="Ej. error de talla, cambio de precio, ticket mal registrado..."
                className="min-h-[96px] resize-none"
                disabled={isSubmittingSaleAction}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeSaleActionDialog}
              disabled={isSubmittingSaleAction}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void handleConfirmSaleAction()}
              disabled={!selectedSale || !voidReason.trim() || isSubmittingSaleAction}
              className={
                pendingSaleAction === "void-and-copy"
                  ? "bg-amber-600 text-white hover:bg-amber-700"
                  : "bg-rose-600 text-white hover:bg-rose-700"
              }
            >
              {isSubmittingSaleAction ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : pendingSaleAction === "void-and-copy" ? (
                "Anular y abrir copia"
              ) : (
                "Confirmar anulacion"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drawer Metadatos de Gastos */}
      <Dialog open={showExpensesDrawer} onOpenChange={setShowExpensesDrawer}>
        <DialogContent className="sm:max-w-md flex max-h-[85vh] min-h-0 flex-col overflow-hidden p-0">
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
          
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
