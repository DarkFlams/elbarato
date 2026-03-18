/**
 * @file cart.tsx
 * @description Panel completo del carrito de ventas.
 *              Incluye: lista de items, resumen por socia, metodo de pago,
 *              boton de registrar venta, y ticket de impresion post-venta.
 */

"use client";

import { useState } from "react";
import { ShoppingCart, DollarSign, Trash2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCart } from "@/hooks/use-cart";
import { CartItemRow } from "./cart-item";
import { PaymentSelector } from "./payment-selector";
import { SaleSummary } from "./sale-summary";
import { SaleTicket } from "./sale-ticket";
import { createClient } from "@/lib/supabase/client";
import type {
  CashSession,
  CartItem,
  PartnerSaleSummary,
} from "@/types/database";
import { toast } from "sonner";
import { playCheckoutSound } from "@/lib/audio";

interface CartProps {
  cashSession: CashSession | null;
}

interface RegisterSaleResult {
  sale_id: string;
  total: number;
  item_count: number;
}

export function Cart({ cashSession }: CartProps) {
  const {
    items,
    paymentMethod,
    isProcessing,
    getTotal,
    getItemCount,
    getPartnerSummaries,
    clearCart,
    setProcessing,
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

  const itemCount = getItemCount();
  const total = getTotal();

  const handleRegisterSale = async () => {
    if (items.length === 0) return;

    if (!cashSession) {
      toast.error("No hay sesion de caja abierta");
      return;
    }

    setProcessing(true);

    try {
      const supabase = createClient();
      const salePayload = items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }));

      const { data, error } = await supabase.rpc("register_sale", {
        p_cash_session_id: cashSession.id,
        p_payment_method: paymentMethod,
        p_items: salePayload,
      });

      if (error) throw error;

      const result = (Array.isArray(data) ? data[0] : data) as
        | RegisterSaleResult
        | null;

      if (!result?.sale_id) {
        throw new Error("No se recibio una respuesta valida al registrar la venta");
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
        description: `${registeredItemCount} producto${registeredItemCount > 1 ? "s" : ""} - ${paymentMethod === "cash" ? "Efectivo" : "Transferencia"} - Ticket disponible`,
      });

      clearCart();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al registrar venta";
      toast.error("Error al registrar venta", { description: message });
      console.error("[Cart] handleRegisterSale error:", err);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <div className="flex flex-col h-full rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-semibold">Carrito</span>
            {itemCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs font-medium rounded-md bg-indigo-100 text-indigo-700">
                {itemCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {lastTicketData && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                onClick={() => setTicketOpen(true)}
                title="Imprimir ultimo ticket"
              >
                <Printer className="h-3.5 w-3.5" />
              </Button>
            )}
            {items.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                onClick={clearCart}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 px-3 py-2">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-slate-400 gap-2">
              <ShoppingCart className="h-10 w-10 opacity-30" />
              <p className="text-sm">El carrito esta vacio</p>
              <p className="text-xs text-slate-400">
                Escanea un producto para comenzar
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {items.map((item, index) => (
                <CartItemRow key={item.product_id} item={item} index={index} />
              ))}
            </div>
          )}
        </ScrollArea>

        {items.length > 0 && (
          <div className="px-4 py-3 space-y-3 border-t border-slate-100">
            <SaleSummary />
            <PaymentSelector />

            <Button
              onClick={handleRegisterSale}
              disabled={isProcessing || !cashSession}
              className="w-full h-12 text-base font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 border-0"
            >
              <DollarSign className="h-5 w-5 mr-2" />
              {isProcessing ? "Registrando..." : "Registrar Venta"}
            </Button>
          </div>
        )}
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
    </>
  );
}
