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
    <div className="relative flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-5 overflow-hidden lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:min-w-[400px]">
          <div className="flex shrink-0 items-center gap-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex-1">
              <ProductSearch />
            </div>

            {lastScanned && (
              <div className="mr-2 hidden items-center text-sm text-slate-500 md:flex">
                Ultimo:
                <code className="ml-1 rounded bg-slate-100 px-1 py-0.5 font-mono font-bold tracking-tight text-indigo-600">
                  {lastScanned}
                </code>
              </div>
            )}

            <Badge
              variant="outline"
              className={`shrink-0 px-3 py-1.5 ${
                session
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              <Wifi className="mr-1.5 h-4 w-4" />
              {sessionLoading
                ? "Inicializando caja local..."
                : session
                  ? "Caja local activa"
                  : "Reintentando sesion local..."}
            </Badge>
          </div>

          <div className="min-h-0 flex-1">
            <Cart />
          </div>

          <div className="flex shrink-0 flex-row gap-4">
            <div className="flex flex-1 flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
              <Label
                htmlFor="notes"
                className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
              >
                <PenLine className="h-3 w-3" />
                Observaciones
              </Label>
              <Textarea
                id="notes"
                placeholder="Ej. Falta entregar producto, cliente VIP..."
                className="flex-1 resize-none border-slate-200/60 bg-slate-50 font-medium text-slate-700 shadow-inner focus-visible:ring-indigo-500/30"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={isProcessing}
              />
            </div>

            <div className="w-[300px] shrink-0 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm xl:w-[320px] 2xl:w-[380px]">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label
                    htmlFor="received"
                    className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[11px]"
                  >
                    <Banknote className="h-3.5 w-3.5 text-emerald-600" />
                    Efectivo recibido
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
                    <Input
                      id="received"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="h-10 border-emerald-200 bg-emerald-50/50 pl-7 font-mono text-lg font-bold text-emerald-900 shadow-inner focus-visible:ring-emerald-500/40"
                      value={amountReceived}
                      onChange={(event) => setAmountReceived(event.target.value)}
                      disabled={isProcessing}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[11px]">
                    Cambio a entregar
                  </Label>
                  <div
                    className={`flex h-10 items-center rounded-md border px-3 font-mono text-lg font-bold shadow-inner transition-colors ${
                      Number(amountReceived) >= total && Number(amountReceived) > 0
                        ? "border-slate-900 bg-slate-800 text-white shadow-slate-900/20"
                        : "border-slate-200 bg-slate-50 text-slate-400"
                    }`}
                  >
                    <DollarSign className="mr-0.5 h-4 w-4 opacity-70" />
                    {Number(amountReceived) > 0
                      ? Math.max(0, Number(amountReceived) - total).toFixed(2)
                      : "0.00"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden min-h-0 w-[300px] shrink-0 flex-col gap-4 lg:flex xl:w-[320px] 2xl:w-[380px]">
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
