/**
 * @file sale-summary.tsx
 * @description Línea de total simple dentro del carrito unificado.
 */

"use client";

import { useCart } from "@/hooks/use-cart";

export function SaleSummary() {
  const { getTotal, getItemCount } = useCart();

  const total = getTotal();
  const itemCount = getItemCount();

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-500 font-medium">
        {itemCount} {itemCount === 1 ? "artículo" : "artículos"}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Total</span>
        <span className="font-mono text-2xl font-black tabular-nums text-slate-900">
          ${total.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
