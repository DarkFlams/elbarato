"use client";

import { ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCart } from "@/hooks/use-cart";
import { CartItemRow } from "./cart-item";

export function Cart() {
  const { items, getItemCount, clearCart } = useCart();
  const itemCount = getItemCount();

  return (
    <div className="flex flex-col h-full rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-0">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center bg-indigo-100 text-indigo-700 w-10 h-10 rounded-full">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              Carrito de Ventas
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {itemCount} producto{itemCount !== 1 ? "s" : ""} en curso
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-red-600 hover:bg-red-50 font-medium h-9 px-3 border border-transparent hover:border-red-100"
            onClick={clearCart}
          >
            <Trash2 className="h-4 w-4 mr-1.5" /> Vaciar Carrito
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 bg-white">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 h-full min-h-[400px] text-slate-400 gap-4">
            <div className="w-24 h-24 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100 border-dashed mb-2 shadow-sm">
              <ShoppingCart className="h-10 w-10 text-slate-300" />
            </div>
            <p className="text-slate-600 font-bold text-xl">
              El carrito está vacío
            </p>
            <p className="text-sm text-slate-400 text-center max-w-[320px] leading-relaxed">
              Utiliza el escáner de código de barras físico o busca un producto en la barra superior para agregarlo.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {items.map((item, index) => (
              <CartItemRow key={item.product_id} item={item} index={index} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
