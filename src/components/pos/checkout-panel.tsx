"use client";

import { useRef, useState } from "react";
import { DollarSign, Printer, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/hooks/use-cart";
import { PaymentSelector } from "./payment-selector";
import { SaleSummary } from "./sale-summary";
import { SaleTicket } from "./sale-ticket";
import type {
  CashSession,
  CartItem,
  PartnerSaleSummary,
} from "@/types/database";
import { toast } from "sonner";
import { playCheckoutSound } from "@/lib/audio";
import { registerSaleWithOfflineFallback } from "@/lib/offline/rpc";

interface CheckoutPanelProps {
  cashSession: CashSession | null;
}

export function CheckoutPanel({ cashSession }: CheckoutPanelProps) {
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

  const itemCount = getItemCount();
  const total = getTotal();

  const handleRegisterSale = async () => {
    if (submitInFlightRef.current || isProcessing) return;
    if (items.length === 0) return;

    if (!cashSession) {
      toast.error("El dia operativo aun no esta listo");
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
        unit_price: item.unit_price,
      }));

      const registerResult = await registerSaleWithOfflineFallback({
        p_cash_session_id: cashSession.id,
        p_payment_method: paymentMethod,
        p_items: salePayload,
        p_notes: notes.trim() || null,
        p_amount_received: paymentMethod === 'cash' && amountReceived ? Number(amountReceived) : null,
        p_change_given: paymentMethod === 'cash' && amountReceived ? Math.max(0, Number(amountReceived) - total) : null,
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
          "No se recibio una respuesta valida al registrar la venta"
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

      playCheckoutSound();
      toast.success(`Venta registrada - $${registeredTotal.toFixed(2)}`, {
        description: `${registeredItemCount} producto${
          registeredItemCount > 1 ? "s" : ""
        } - ${
          paymentMethod === "cash" ? "Efectivo" : "Transferencia"
        } - Ticket disponible`,
      });

      clearCart();
      saleRequestKeyRef.current = null;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al registrar venta";
      toast.error("Error al registrar venta", { description: message });
      console.error("[Checkout] handleRegisterSale error:", err);
    } finally {
      setProcessing(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <div className="flex flex-col flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden shrink-0 min-h-0">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-indigo-600" />
          <h3 className="font-semibold text-slate-800">Resumen y Pago</h3>
        </div>
        {lastTicketData && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTicketOpen(true)}
            className="h-8 text-xs font-semibold text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 border-slate-200"
          >
            <Printer className="h-3.5 w-3.5 mr-1.5" /> Último Ticket
          </Button>
        )}
      </div>

      <div className="p-5 flex-1 flex flex-col gap-6 overflow-y-auto w-full">
        {/* Siempre se muestra el SaleSummary. Si está vacío muestra 0.00 */}
        <SaleSummary />

        <div className="space-y-3 flex-1 flex flex-col justify-end">
          <p className="text-sm font-semibold text-slate-700">
            Método de Pago
          </p>
          <PaymentSelector />
        </div>

        <Button
          onClick={handleRegisterSale}
          disabled={
            isProcessing || 
            !cashSession || 
            !paymentMethod || 
            items.length === 0 || 
            (paymentMethod === "cash" && Number(amountReceived) > 0 && Number(amountReceived) < total)
          }
          className={`w-full h-16 text-lg font-bold shadow-md transition-all duration-200 border-0 shrink-0 ${
            items.length === 0 || (paymentMethod === "cash" && Number(amountReceived) > 0 && Number(amountReceived) < total)
              ? "bg-slate-100 text-slate-400 shadow-none cursor-not-allowed"
              : !paymentMethod
              ? "bg-slate-200 text-slate-500 cursor-not-allowed shadow-none"
              : paymentMethod === "cash"
              ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20 text-white hover:-translate-y-0.5 active:translate-y-0"
              : "bg-sky-600 hover:bg-sky-700 shadow-sky-600/20 text-white hover:-translate-y-0.5 active:translate-y-0"
          }`}
        >
          <DollarSign className="h-6 w-6 mr-2" />
          {isProcessing ? "Registrando..." : "Registrar Venta"}
        </Button>
      </div>

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

