"use client";

import { useState, useRef, useEffect } from "react";
import { Minus, Plus, X } from "lucide-react";
import { PRICE_TIER_OPTIONS, getPriceForTier, getTierLabel } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import type { CartItem as CartItemType } from "@/types/database";
import { useCart } from "@/hooks/use-cart";
import { toast } from "sonner";

interface CartItemProps {
  item: CartItemType;
  index: number;
}

export function CartItemRow({ item, index }: CartItemProps) {
  const { updateQuantity, removeItem, updatePrice, updatePriceTier } = useCart();
  const isOutOfStock = item.quantity > item.available_stock;
  const [editingPrice, setEditingPrice] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleIncrease = () => {
    updateQuantity(item.id, item.quantity + 1);
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
    updatePrice(item.id, newUnitPrice);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditingPrice(false);
  };

  const handleTierChange = (tier: (typeof PRICE_TIER_OPTIONS)[number]["value"]) => {
    const result = updatePriceTier(item.id, tier);
    if (!result.ok) {
      toast.error(`Falta precio ${getTierLabel(tier)}`, {
        description: `${item.name} no tiene configurado ese tier.`,
      });
    }
  };

  return (
    <tr
      className="group transition-colors bg-white hover:bg-slate-50/80 animate-[slide-in-right_0.2s_ease-out_forwards] select-none"
      style={{
        animationDelay: `${index * 30}ms`,
        opacity: 0,
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input')) return;
        removeItem(item.id);
      }}
    >
      <td className="px-2 py-1.5 text-center text-[11px] font-medium text-slate-400 border-b border-slate-100/60">
        {index + 1}
      </td>
      <td className="px-2 py-1.5 border-b border-slate-100/60">
        <span className="font-mono text-[11px] text-slate-500 uppercase">{item.sku || item.barcode}</span>
      </td>
      <td className="px-2 py-1.5 relative border-b border-slate-100/60">
        <div 
          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-md"
          style={{ backgroundColor: item.owner_color }}
          title={item.owner_display_name}
        />
        <div className="flex flex-col justify-center pl-1.5 w-[140px] 2xl:w-[200px]">
          <span className="truncate text-[12px] font-semibold text-slate-800 leading-tight block">
            {item.name}
          </span>
          {isOutOfStock && (
            <span className="inline-block mt-0.5 text-[9px] font-bold text-amber-600 bg-amber-50 px-1 rounded-sm w-fit uppercase tracking-tight">
              Sin stock
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right border-b border-slate-100/60">
        <div className="inline-flex items-center justify-end gap-1 bg-slate-100/80 p-0.5 rounded">
          <button
            className="flex h-4 w-4 items-center justify-center rounded-sm text-slate-500 hover:bg-white hover:text-slate-900 transition-colors shadow-sm"
            onClick={() => updateQuantity(item.id, item.quantity - 1)}
          >
            <Minus className="h-2.5 w-2.5" />
          </button>
          <span className="w-5 text-center text-xs font-bold tabular-nums text-slate-800">
            {item.quantity}
          </span>
          <button
            className="flex h-4 w-4 items-center justify-center rounded-sm text-slate-500 hover:bg-white hover:text-slate-900 transition-colors shadow-sm"
            onClick={handleIncrease}
          >
            <Plus className="h-2.5 w-2.5" />
          </button>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right border-b border-slate-100/60">
        <div className="flex flex-col items-end gap-1">
          <div className="font-mono text-[12px] tabular-nums text-slate-500">
            ${item.price_override.toFixed(2)}
          </div>
          <div className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 p-0.5">
            {PRICE_TIER_OPTIONS.map((option) => {
              const tierPrice = getPriceForTier(item, option.value);
              const isDisabled =
                tierPrice === null || tierPrice === undefined || tierPrice <= 0;
              const isActive = item.price_tier === option.value;

              return (
                <button
                  key={`${item.id}-${option.value}`}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleTierChange(option.value)}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[9px] font-bold transition-colors",
                    isActive
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-white hover:text-slate-900",
                    isDisabled && "cursor-not-allowed text-slate-300 hover:bg-transparent hover:text-slate-300"
                  )}
                >
                  {option.value === "normal" ? "N" : option.shortLabel}
                </button>
              );
            })}
            {item.price_tier === "manual" && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                M
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right border-b border-slate-100/60">
        {editingPrice ? (
          <input
            ref={inputRef}
            type="number"
            step="0.01"
            className="w-16 rounded border border-indigo-300 bg-indigo-50 px-1 py-0.5 text-right font-mono text-[12px] font-bold tabular-nums text-indigo-900 outline-none focus:ring-1 focus:ring-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleEditKeyDown}
          />
        ) : (
          <button
            onClick={startEditing}
            className="group/price inline-block cursor-pointer rounded px-1 min-w-[50px] py-0.5 text-right transition-colors hover:bg-indigo-50"
            title="Click para editar precio/subtotal"
          >
            <span className="font-mono text-[13px] font-black tabular-nums text-slate-900 transition-colors group-hover/price:text-indigo-700">
              ${item.subtotal.toFixed(2)}
            </span>
          </button>
        )}
      </td>
      <td className="px-1 py-1.5 text-center border-b border-slate-100/60">
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 mx-auto"
          onClick={() => removeItem(item.id)}
          title="Eliminar producto"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

