/**
 * @file caja/page.tsx
 * @description Pantalla principal del Punto de Venta (POS).
 * Layout: Carrito unificado (izq) + Stats/Gastos (der)
 */

"use client";

import { useCallback, useState } from "react";
import {
  Banknote,
  ChevronDown,
  ChevronUp,
  DollarSign,
  PenLine,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { findCatalogProductByBarcode } from "@/lib/local/catalog";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { useCart } from "@/hooks/use-cart";
import { useCashSession } from "@/hooks/use-cash-session";
import { playErrorSound, playSuccessSound } from "@/lib/audio";
import { Cart } from "@/components/pos/cart";
import { ExpensesPanel } from "@/components/pos/expenses-panel";
import { PosTabs } from "@/components/pos/pos-tabs";
import { ProductSearch } from "@/components/pos/product-search";
import { SessionStats } from "@/components/pos/session-stats";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProductWithOwner } from "@/types/database";

export default function CajaPage() {
  const { session, isLoading: sessionLoading } = useCashSession();
  const {
    addItem,
    activeTabId,
    items,
    notes,
    setNotes,
    amountReceived,
    setAmountReceived,
    getTotal,
    isProcessing,
  } = useCart();
  const total = getTotal();

  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const handleScan = useCallback(
    async (barcode: string) => {
      setLastScanned(barcode);

      try {
        const data = await findCatalogProductByBarcode(barcode);

        if (!data) {
          playErrorSound();
          toast.error("Producto no encontrado", {
            description: `Codigo: ${barcode}`,
          });
          return;
        }

        const product = data as ProductWithOwner;
        const result = addItem(product);

        if (!result.ok) {
          playErrorSound();
          if (result.reason === "price_tier_unavailable") {
            toast.error(`Falta precio ${result.appliedTier ?? "seleccionado"}`, {
              description: `${product.name} no tiene configurado ese tier.`,
            });
            return;
          }
          toast.warning(`No puedes agregar mas de ${product.name}`, {
            description: `Error: ${result.reason}`,
          });
          return;
        }

        playSuccessSound();
        if (product.stock <= 0) {
          toast.warning(`${product.name} agregado sin stock`, {
            description: "Se vendera en negativo.",
          });
        } else if (result.appliedPrice !== undefined) {
          toast.success(`${product.name} agregado`, {
            description: `$${result.appliedPrice.toFixed(2)} - ${result.appliedTier ?? "normal"}`,
          });
        }
      } catch (error) {
        console.error("[CajaPage] scan error:", error);
        toast.error("Error al buscar producto");
      }
    },
    [addItem]
  );

  useBarcodeScanner({ onScan: handleScan, enabled: true });

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-2.5">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-2.5 overflow-hidden lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 lg:min-w-[400px]">
          <PosTabs />

          <div className="flex shrink-0 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
            <div className="flex-1">
              <ProductSearch />
            </div>

            {lastScanned && (
              <div className="mr-1 hidden items-center text-xs text-slate-500 md:flex">
                Ultimo:
                <code className="ml-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] font-bold tracking-tight text-indigo-600">
                  {lastScanned}
                </code>
              </div>
            )}

            <Badge
              variant="outline"
              className={`shrink-0 px-2.5 py-1 text-xs ${
                session
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              <Wifi className="mr-1.5 h-4 w-4" />
              {sessionLoading
                ? "Inicializando dia actual..."
                : session
                  ? "Dia operativo listo"
                  : "Reintentando dia actual..."}
            </Badge>
          </div>

          <div
            key={activeTabId}
            className="flex min-h-0 flex-1 flex-col gap-2.5 animate-in fade-in-0 slide-in-from-right-2 zoom-in-[0.99] duration-200"
          >
            <div className="min-h-0 flex-1">
              <Cart />
            </div>

            <div className="flex shrink-0 flex-row items-start gap-2.5">
              <div className="flex flex-1 flex-col gap-0.5 rounded-xl border border-slate-200 bg-white px-1.5 pb-1.5 pt-1 shadow-sm">
                <Label
                  htmlFor="notes"
                  className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  <PenLine className="h-2.5 w-2.5" />
                  Observaciones
                </Label>
                <Textarea
                  id="notes"
                  className="min-h-[42px] resize-none border-slate-200/60 bg-slate-50 px-2.5 py-2 text-[13px] font-medium leading-tight text-slate-700 shadow-inner focus-visible:ring-indigo-500/30"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  disabled={isProcessing}
                />
              </div>

              <div className="w-[255px] shrink-0 rounded-xl border border-slate-200 bg-white px-1.5 pb-1.5 pt-1 shadow-sm xl:w-[275px] 2xl:w-[310px]">
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="received"
                      className="flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                    >
                      <Banknote className="h-3 w-3 text-emerald-600" />
                      Efectivo recibido
                    </Label>
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-600" />
                      <Input
                        id="received"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className="h-8 border-emerald-200 bg-emerald-50/50 pl-7 font-mono text-[15px] font-bold text-emerald-900 shadow-inner focus-visible:ring-emerald-500/40"
                        value={amountReceived}
                        onChange={(event) => setAmountReceived(event.target.value)}
                        disabled={isProcessing}
                      />
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Cambio a entregar
                    </Label>
                    <div
                      className={`flex h-8 items-center rounded-md border px-3 font-mono text-[15px] font-bold shadow-inner transition-colors ${
                        Number(amountReceived) >= total && Number(amountReceived) > 0
                          ? "border-slate-900 bg-slate-800 text-white shadow-slate-900/20"
                          : "border-slate-200 bg-slate-50 text-slate-400"
                      }`}
                    >
                      <DollarSign className="mr-0.5 h-3.5 w-3.5 opacity-70" />
                      {Number(amountReceived) > 0
                        ? Math.max(0, Number(amountReceived) - total).toFixed(2)
                        : "0.00"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden min-h-0 w-[265px] shrink-0 flex-col gap-2.5 lg:flex xl:w-[280px] 2xl:w-[310px]">
          <SessionStats />
          <ExpensesPanel />
        </div>
      </div>

      <div className="mt-auto shrink-0 lg:hidden">
        <button
          onClick={() => setMobileCartOpen((current) => !current)}
          className="flex w-full items-center justify-between rounded-t-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Gastos del dia</span>
            {items.length > 0 && (
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 text-amber-700"
              >
                {items.length}
              </Badge>
            )}
          </div>

          {mobileCartOpen ? (
            <ChevronDown className="h-4 w-4 text-slate-500" />
          ) : (
            <ChevronUp className="h-4 w-4 text-slate-500" />
          )}
        </button>

        {mobileCartOpen && (
          <div className="flex h-[60vh] flex-col gap-4 overflow-y-auto rounded-b-xl border-x border-b border-slate-200 bg-slate-50 p-4 shadow-sm">
            <SessionStats />
            <ExpensesPanel />
          </div>
        )}
      </div>
    </div>
  );
}


