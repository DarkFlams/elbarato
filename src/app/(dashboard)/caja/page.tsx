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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { useCart } from "@/hooks/use-cart";
import { useCashSession } from "@/hooks/use-cash-session";
import { Cart } from "@/components/pos/cart";
import { ProductSearch } from "@/components/pos/product-search";
import { Badge } from "@/components/ui/badge";
import type { ProductWithOwner } from "@/types/database";
import { PARTNERS } from "@/lib/constants";
import { toast } from "sonner";
import { playSuccessSound, playErrorSound } from "@/lib/audio";

export default function CajaPage() {
  const { session, isLoading: sessionLoading, openSession } = useCashSession();
  const { addItem, getPartnerSummaries, items } = useCart();
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  useEffect(() => {
    if (!sessionLoading && !session) {
      openSession(0);
    }
  }, [sessionLoading, session, openSession]);

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
          .eq("barcode", barcode)
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

  const partnerSummaries = getPartnerSummaries();

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Punto de Venta</h1>
          <p className="text-sm text-muted-foreground">
            Escanea un codigo de barras o busca un producto
          </p>
        </div>

        <Badge
          variant="outline"
          className={
            session
              ? "border-emerald-200 text-emerald-700 bg-emerald-50"
              : "border-amber-200 text-amber-700 bg-amber-50"
          }
        >
          {session ? (
            <>
              <Wifi className="h-3 w-3 mr-1" />
              Sesion activa
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 mr-1" />
              {sessionLoading ? "Cargando..." : "Sin sesion"}
            </>
          )}
        </Badge>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 min-h-0">
        <div className="flex flex-col gap-4 min-h-0">
          <ProductSearch />

          <div className="flex-1 min-h-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <Cart cashSession={session} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(Object.keys(PARTNERS) as Array<keyof typeof PARTNERS>).map(
              (key) => {
                const partner = PARTNERS[key];
                const summary = partnerSummaries.find(
                  (s) => s.partner_name === key
                );

                return (
                  <div
                    key={key}
                    className="rounded-lg border border-slate-200 bg-white shadow-sm p-3 transition-all duration-200 hover:shadow-md"
                    style={{
                      borderLeftWidth: "3px",
                      borderLeftColor: partner.color,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: partner.color }}
                      />
                      <span className="text-xs font-medium text-muted-foreground">
                        {partner.displayName}
                      </span>
                    </div>
                    <p className="font-mono text-lg font-bold tabular-nums">
                      ${(summary?.total ?? 0).toFixed(2)}
                    </p>
                  </div>
                );
              }
            )}
          </div>
        </div>

        <div className="hidden lg:block min-h-0">
          <div className="h-full rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col items-center justify-center gap-4 p-6">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                lastScanned
                  ? "bg-emerald-50 text-emerald-600 shadow-sm"
                  : "bg-slate-50 text-slate-400"
              }`}
            >
              <ScanBarcode className="w-8 h-8" />
            </div>

            <div className="text-center">
              <h2 className="text-lg font-semibold">
                {lastScanned ? "Ultimo escaneo" : "Escaner listo"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {lastScanned ? (
                  <code className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-xs">
                    {lastScanned}
                  </code>
                ) : (
                  "Apunta la pistola de codigos de barras a una etiqueta"
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <button
          onClick={() => setMobileCartOpen(!mobileCartOpen)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-t-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Carrito</span>
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
          <div className="h-[60vh] border-x border-b border-slate-200 rounded-b-xl overflow-hidden bg-white shadow-sm">
            <Cart cashSession={session} />
          </div>
        )}
      </div>
    </div>
  );
}
