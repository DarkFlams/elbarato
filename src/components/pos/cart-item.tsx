/**
 * @file cart-item.tsx
 * @description Linea individual del carrito de venta.
 */

"use client";

import { Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CartItem as CartItemType } from "@/types/database";
import { useCart } from "@/hooks/use-cart";
import { toast } from "sonner";

interface CartItemProps {
  item: CartItemType;
  index: number;
}

export function CartItemRow({ item, index }: CartItemProps) {
  const { updateQuantity, removeItem } = useCart();
  const reachedStockLimit = item.quantity >= item.available_stock;

  const handleIncrease = () => {
    const result = updateQuantity(item.product_id, item.quantity + 1);
    if (!result.ok && result.reason === "quantity_limit") {
      toast.warning(`Maximo disponible: ${result.availableStock ?? item.available_stock}`, {
        description: item.name,
      });
    }
  };

  return (
    <div
      className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-white transition-all duration-200 hover:bg-slate-50 animate-[slide-in-right_0.3s_ease-out_forwards] shadow-sm"
      style={{
        borderLeftWidth: "3px",
        borderLeftColor: item.owner_color,
        boxShadow: `inset 4px 0 12px ${item.owner_color}15`,
        animationDelay: `${index * 50}ms`,
        opacity: 0,
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-slate-900">
          {item.name}
        </p>
        <p className="text-xs text-slate-500">
          <span
            className="inline-block w-2 h-2 rounded-full mr-1"
            style={{ backgroundColor: item.owner_color }}
          />
          {item.owner_display_name}
        </p>
        <p className="text-[10px] text-slate-400">
          Stock disponible: {item.available_stock}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-md hover:bg-slate-100 text-slate-600"
          onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
        >
          <Minus className="h-3 w-3" />
        </Button>

        <span className="w-6 text-center text-sm font-medium tabular-nums">
          {item.quantity}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-md hover:bg-slate-100 text-slate-600 disabled:opacity-40"
          onClick={handleIncrease}
          disabled={reachedStockLimit}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <span className="font-mono text-sm font-semibold tabular-nums min-w-[60px] text-right">
        ${item.subtotal.toFixed(2)}
      </span>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 rounded-md opacity-0 group-hover:opacity-100 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-opacity"
        onClick={() => removeItem(item.product_id)}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
