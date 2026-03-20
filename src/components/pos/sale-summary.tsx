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
      <span className="text-[13px] font-medium text-slate-500">
        {itemCount} {itemCount === 1 ? "artículo" : "artículos"}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Total</span>
        <span className="font-mono text-[34px] font-black leading-none tabular-nums text-slate-900">
          ${total.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

