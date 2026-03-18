/**
 * @file cart.tsx
 * @description Carrito de ventas unificado. Incluye items, total,
 *              selector de pago y botón de registrar venta.
 */

"use client";

import { useRef, useState } from "react";
import { ShoppingCart, Trash2, DollarSign, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCart } from "@/hooks/use-cart";
import { useCashSession } from "@/hooks/use-cash-session";
import { CartItemRow } from "./cart-item";
import { SaleSummary } from "./sale-summary";
import { PaymentSelector } from "./payment-selector";
import { SaleTicket } from "./sale-ticket";
import type { CartItem, PartnerSaleSummary } from "@/types/database";
import { toast } from "sonner";
import { playCheckoutSound } from "@/lib/audio";
import { registerSaleWithOfflineFallback } from "@/lib/offline/rpc";

export function Cart() {
  const {
    items,
    paymentMethod,
    isProcessing,
    getTotal,
    getItemCount,
    getPartnerSummaries,
    clearCart,
    setProcessing,
    notes,
    amountReceived,
  } = useCart();

  const { session } = useCashSession();
  const itemCount = getItemCount();
  const total = getTotal();

  const [ticketOpen, setTicketOpen] = useState(false);
  const [lastTicketData, setLastTicketData] = useState<{
    items: CartItem[];
    summaries: PartnerSaleSummary[];
    total: number;
    paymentMethod: "cash" | "transfer";
    saleId: string;
    date: Date;
  } | null>(null);
  const submitInFlightRef = useRef(false);
  const saleRequestKeyRef = useRef<string | null>(null);

  const handleRegisterSale = async () => {
    if (submitInFlightRef.current || isProcessing) return;
    if (items.length === 0) return;

    if (!session) {
      toast.error("No hay sesión de caja abierta");
      return;
    }

    if (!paymentMethod) {
      toast.error("Elige un método de pago");
      return;
    }

    const requestKey =
      saleRequestKeyRef.current ??
      (globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    saleRequestKeyRef.current = requestKey;
    submitInFlightRef.current = true;
    setProcessing(true);

    try {
      const salePayload = items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.price_override,
      }));

      const registerResult = await registerSaleWithOfflineFallback({
        p_cash_session_id: session.id,
        p_payment_method: paymentMethod,
        p_items: salePayload,
        p_notes: notes.trim() || null,
        p_amount_received:
          paymentMethod === "cash" && amountReceived
            ? Number(amountReceived)
            : null,
        p_change_given:
          paymentMethod === "cash" && amountReceived
            ? Math.max(0, Number(amountReceived) - total)
            : null,
        p_idempotency_key: requestKey,
      });

      if (registerResult.mode === "queued") {
        const offlineSaleId = `OFFLINE-${registerResult.operation_id
          .slice(0, 8)
          .toUpperCase()}`;
        const ticketSnapshot = {
          items: [...items],
          summaries: getPartnerSummaries(),
          total,
          paymentMethod,
          saleId: offlineSaleId,
          date: new Date(),
        };
        setLastTicketData(ticketSnapshot);
        setTicketOpen(true);

        playCheckoutSound();
        toast.warning(`Venta guardada offline - $${total.toFixed(2)}`, {
          description:
            "Pendiente de sincronizacion. Se enviara al volver internet.",
        });

        clearCart();
        saleRequestKeyRef.current = null;
        return;
      }

      const result = registerResult.data;

      if (!result?.sale_id) {
        throw new Error(
          "No se recibió una respuesta válida al registrar la venta"
        );
      }

      const registeredTotal = Number(result.total ?? total);
      const registeredItemCount = Number(result.item_count ?? itemCount);

      const ticketSnapshot = {
        items: [...items],
        summaries: getPartnerSummaries(),
        total: registeredTotal,
        paymentMethod,
        saleId: result.sale_id,
        date: new Date(),
      };
      setLastTicketData(ticketSnapshot);
      setTicketOpen(true);

      playCheckoutSound();
      toast.success(`Venta registrada - $${registeredTotal.toFixed(2)}`, {
        description: `${registeredItemCount} producto${
          registeredItemCount > 1 ? "s" : ""
        } - ${
          paymentMethod === "cash" ? "Efectivo" : "Transferencia"
        }`,
      });

      clearCart();
      saleRequestKeyRef.current = null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al registrar venta";
      toast.error("Error al registrar venta", { description: message });
      console.error("[Cart] handleRegisterSale error:", err);
    } finally {
      setProcessing(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <div className="flex flex-col h-full rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center bg-indigo-100 text-indigo-700 w-9 h-9 rounded-full">
            <ShoppingCart className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800">
              Carrito de Ventas
            </h2>
            <p className="text-xs text-slate-500">
              {itemCount} producto{itemCount !== 1 ? "s" : ""} en curso
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastTicketData && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTicketOpen(true)}
              className="h-8 text-xs font-semibold text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 border-slate-200"
            >
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Ticket
            </Button>
          )}
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-red-600 hover:bg-red-50 font-medium h-8 px-2.5"
              onClick={clearCart}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Vaciar
            </Button>
          )}
        </div>
      </div>

      {/* Items */}
      <ScrollArea className="flex-1 min-h-0 bg-white">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 lg:p-12 h-full min-h-[150px] text-slate-400 gap-3">
            <div className="w-20 h-20 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100 border-dashed">
              <ShoppingCart className="h-8 w-8 text-slate-300" />
            </div>
            <p className="text-slate-500 font-bold text-lg">
              El carrito está vacío
            </p>
            <p className="text-sm text-slate-400 text-center max-w-[280px] leading-relaxed">
              Escanea un código de barras o busca un producto arriba.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {items.map((item, index) => (
              <CartItemRow
                key={item.product_id}
                item={item}
                index={index}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer: Total + Pago + Registrar */}
      <div className="border-t border-slate-200 bg-slate-50/30 px-5 py-2.5 space-y-2.5 shrink-0">
        <SaleSummary />

        <PaymentSelector />

        <Button
          onClick={handleRegisterSale}
          disabled={
            isProcessing ||
            !session ||
            !paymentMethod ||
            items.length === 0 ||
            (paymentMethod === "cash" &&
              Number(amountReceived) > 0 &&
              Number(amountReceived) < total)
          }
          className={`w-full h-11 text-base font-bold shadow-md transition-all duration-200 border-0 ${
            items.length === 0
              ? "bg-slate-100 text-slate-400 shadow-none cursor-not-allowed"
              : !paymentMethod
              ? "bg-slate-200 text-slate-500 cursor-not-allowed shadow-none"
              : paymentMethod === "cash"
              ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20 text-white"
              : "bg-sky-600 hover:bg-sky-700 shadow-sky-600/20 text-white"
          }`}
        >
          <DollarSign className="h-5 w-5 mr-2" />
          {isProcessing
            ? "Registrando..."
            : items.length === 0
            ? "Registrar Venta"
            : `Registrar Venta - $${total.toFixed(2)}`}
        </Button>
      </div>

      {/* Ticket Modal */}
      {lastTicketData && (
        <SaleTicket
          open={ticketOpen}
          onClose={() => setTicketOpen(false)}
          items={lastTicketData.items}
          partnerSummaries={lastTicketData.summaries}
          total={lastTicketData.total}
          paymentMethod={lastTicketData.paymentMethod}
          saleId={lastTicketData.saleId}
          date={lastTicketData.date}
        />
      )}
    </div>
  );
}

