/**
 * @file caja/page.tsx
 * @description Pantalla principal del Punto de Venta (POS).
 */

"use client";

import { useCallback, useState, useEffect } from "react";
import {
  ScanBarcode,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronUp,
  Banknote,
  DollarSign,
  PenLine,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { useCart } from "@/hooks/use-cart";
import { useCashSession } from "@/hooks/use-cash-session";
import { Cart } from "@/components/pos/cart";
import { ProductSearch } from "@/components/pos/product-search";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProductWithOwner } from "@/types/database";
import { toast } from "sonner";
import { playSuccessSound, playErrorSound } from "@/lib/audio";
import { OpenSessionModal } from "@/components/pos/open-session-modal";
import { SessionStats } from "@/components/pos/session-stats";
import { CheckoutPanel } from "@/components/pos/checkout-panel";

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
    paymentMethod, 
    isProcessing 
  } = useCart();
  const total = getTotal();

  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const handleScan = useCallback(
    async (barcode: string) => {
      setLastScanned(barcode);

      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("products")
          .select(
            `
            *,
            owner:partners!products_owner_id_fkey (
              id, name, display_name, color_hex
            )
          `
          )
          .or(`barcode.eq.${barcode},sku.eq.${barcode}`)
          .eq("is_active", true)
          .maybeSingle();

        if (error) throw error;

        if (!data) {
          playErrorSound();
          toast.error("Producto no encontrado", {
            description: `Codigo: ${barcode}`,
          });
          return;
        }

        const product = data as unknown as ProductWithOwner;

        if (product.stock <= 0) {
          playErrorSound();
          toast.error(`${product.name} sin stock`, {
            description: `Stock actual: ${product.stock}`,
          });
          return;
        }

        const result = addItem(product);
        if (!result.ok) {
          playErrorSound();
          toast.warning(`No puedes agregar mas de ${product.name}`, {
            description: `Stock disponible: ${result.availableStock ?? product.stock}`,
          });
          return;
        }

        // En modo cobro fluido evitamos toast de exito por cada escaneo.
        playSuccessSound();
      } catch (err) {
        console.error("[CajaPage] scan error:", err);
        toast.error("Error al buscar producto");
      }
    },
    [addItem]
  );

  useBarcodeScanner({ onScan: handleScan, enabled: true });

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] gap-4 relative">
      <OpenSessionModal />

      <div className="flex-1 flex flex-col lg:flex-row gap-5 min-h-0 w-full overflow-hidden">
        
        {/* BLOQUE IZQUIERDO: Buscador y Carrito (Principal) */}
        <div className="flex-1 flex flex-col gap-4 min-h-0 min-w-[500px]">
          
          <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm shrink-0">
            <div className="flex-1">
              <ProductSearch />
            </div>
            {lastScanned && (
              <div className="hidden md:flex items-center text-sm text-slate-500 mr-2">
                Último: <code className="ml-1 bg-slate-100 px-1 py-0.5 rounded text-indigo-600 font-mono font-bold tracking-tight">{lastScanned}</code>
              </div>
            )}
            <Badge
              variant="outline"
              className={`px-3 py-1.5 shrink-0 ${
                session
                  ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                  : "border-amber-200 text-amber-700 bg-amber-50"
              }`}
            >
              {session ? (
                <>
                  <Wifi className="h-4 w-4 mr-1.5" /> Sesión Activa
                </>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 mr-1.5" />
                  {sessionLoading ? "Cargando..." : "Caja Cerrada"}
                </>
              )}
            </Badge>
          </div>

          <div className="flex-1 min-h-0">
            <Cart />
          </div>

          {/* PANEL INFERIOR: Observaciones y Calculadora */}
          <div className="flex flex-row gap-4 shrink-0 h-[100px]">
            {/* Tarjeta de Observaciones */}
            <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2">
              <Label htmlFor="notes" className="text-slate-500 font-semibold flex items-center gap-2 text-xs uppercase tracking-wide">
                <PenLine className="h-3.5 w-3.5" />
                Observaciones de Venta
              </Label>
              <Textarea 
                id="notes"
                placeholder="Ej. Falta entregar producto X, Cliente VIP..." 
                className="resize-none flex-1 bg-slate-50 shadow-inner border-slate-200/60 focus-visible:ring-indigo-500/30 font-medium text-slate-700"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isProcessing}
              />
            </div>

            {/* Tarjeta de Calculadora */}
            <div className="w-[380px] shrink-0 bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="received" className="text-slate-500 font-semibold flex items-center gap-1.5 text-xs uppercase tracking-wide">
                    <Banknote className="h-3.5 w-3.5 text-emerald-600" />
                    Efectivo Recibido
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-600 font-bold" />
                    <Input 
                      id="received"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="pl-8 h-12 text-xl font-bold font-mono border-emerald-200 bg-emerald-50/50 text-emerald-900 focus-visible:ring-emerald-500/40 shadow-inner"
                      value={amountReceived}
                      onChange={(e) => setAmountReceived(e.target.value)}
                      disabled={isProcessing}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-slate-500 font-semibold flex items-center gap-1.5 text-xs uppercase tracking-wide">
                    Cambio a Entregar
                  </Label>
                  <div className={`flex items-center h-12 px-3 rounded-md border text-xl font-bold font-mono transition-colors shadow-inner ${
                    Number(amountReceived) >= total && Number(amountReceived) > 0
                      ? "bg-slate-800 border-slate-900 text-white shadow-slate-900/20"
                      : "bg-slate-50 border-slate-200 text-slate-400"
                  }`}>
                    <DollarSign className="h-4 w-4 mr-0.5 opacity-70" />
                    {Number(amountReceived) > 0 ? Math.max(0, Number(amountReceived) - total).toFixed(2) : "0.00"}
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* BLOQUE DERECHO: Stats y Pago (Sidebar Fija) */}
        <div className="hidden lg:flex flex-col w-[380px] xl:w-[420px] shrink-0 gap-4 min-h-0">
          <SessionStats />
          <CheckoutPanel cashSession={session} />
        </div>

      </div>

      {/* MOBILE TRAY */}
      <div className="lg:hidden shrink-0 mt-auto">
        <button
          onClick={() => setMobileCartOpen(!mobileCartOpen)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-t-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Resumen y Pago</span>
            {items.length > 0 && (
              <Badge
                variant="outline"
                className="border-indigo-200 bg-indigo-50 text-indigo-700"
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
          <div className="h-[75vh] border-x border-b border-slate-200 rounded-b-xl flex flex-col gap-4 bg-slate-50 shadow-sm p-4 overflow-y-auto">
            <SessionStats />
            <CheckoutPanel cashSession={session} />
          </div>
        )}
      </div>
    </div>
  );
}
