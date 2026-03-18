/**
 * @file cart-item.tsx
 * @description Linea individual del carrito de venta.
 *              Diseño limpio: dot color + nombre bold + subtotal editable.
 */

"use client";

import { useState, useRef, useEffect } from "react";
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
  const { updateQuantity, removeItem, updatePrice } = useCart();
  const reachedStockLimit = item.quantity >= item.available_stock;
  const [editingPrice, setEditingPrice] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleIncrease = () => {
    const result = updateQuantity(item.product_id, item.quantity + 1);
    if (!result.ok && result.reason === "quantity_limit") {
      toast.warning(`Máximo disponible: ${result.availableStock ?? item.available_stock}`, {
        description: item.name,
      });
    }
  };

  const startEditing = () => {
    setEditValue(item.subtotal.toFixed(2));
    setEditingPrice(true);
  };

  useEffect(() => {
    if (editingPrice && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingPrice]);

  const commitEdit = () => {
    setEditingPrice(false);
    const newSubtotal = parseFloat(editValue);
    if (isNaN(newSubtotal) || newSubtotal < 0) return;
    // Derivar precio unitario a partir del nuevo subtotal
    const newUnitPrice = newSubtotal / item.quantity;
    updatePrice(item.product_id, newUnitPrice);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditingPrice(false);
  };

  return (
    <div
      className="group relative flex items-center gap-4 px-4 py-3 rounded-lg border border-slate-200 bg-white transition-all duration-150 hover:bg-slate-50/80 animate-[slide-in-right_0.3s_ease-out_forwards]"
      style={{
        borderLeftWidth: "4px",
        borderLeftColor: item.owner_color,
        animationDelay: `${index * 50}ms`,
        opacity: 0,
      }}
    >
      {/* Eliminar (flotante) */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-white border border-slate-200 opacity-0 group-hover:opacity-100 text-slate-400 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all shadow-sm z-10"
        onClick={() => removeItem(item.product_id)}
      >
        <X className="h-3 w-3" />
      </Button>

      {/* Nombre del producto */}
      <div className="flex-1 min-w-0">
        <p className="text-base font-bold truncate text-slate-800 leading-tight">
          {item.name}
        </p>
        <p className="text-xs text-slate-400 mt-0.5 font-mono">
          ${item.price_override.toFixed(2)} c/u
        </p>
      </div>

      {/* Controles de cantidad */}
      <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md hover:bg-white text-slate-600 shadow-none"
          onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>

        <span className="w-7 text-center text-sm font-bold tabular-nums text-slate-800">
          {item.quantity}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md hover:bg-white text-slate-600 shadow-none disabled:opacity-40"
          onClick={handleIncrease}
          disabled={reachedStockLimit}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Subtotal editable */}
      {editingPrice ? (
        <input
          ref={inputRef}
          type="number"
          step="0.01"
          min="0"
          className="w-24 text-right text-lg font-black font-mono tabular-nums text-slate-900 bg-indigo-50 border border-indigo-300 rounded-md px-2 py-1 outline-none focus:ring-2 focus:ring-indigo-500/40"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleEditKeyDown}
        />
      ) : (
        <button
          onClick={startEditing}
          className="min-w-[80px] text-right cursor-pointer group/price hover:bg-slate-100 rounded-md px-2 py-1 transition-colors"
          title="Click para editar precio"
        >
          <span className="font-mono text-lg font-black tabular-nums text-slate-900 group-hover/price:text-indigo-600 transition-colors">
            ${item.subtotal.toFixed(2)}
          </span>
        </button>
      )}
    </div>
  );
}
