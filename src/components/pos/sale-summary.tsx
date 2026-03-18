/**
 * @file sale-summary.tsx
 * @description Resumen de venta: desglose por socia y total general.
 *              Se muestra en la parte inferior del carrito.
 */

"use client";

import { useCart } from "@/hooks/use-cart";

export function SaleSummary() {
  const { getPartnerSummaries, getTotal } = useCart();

  const summaries = getPartnerSummaries();
  const total = getTotal();

  if (summaries.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-2 border-t border-slate-100">
      {/* Desglose por socia */}
      {summaries.map((summary) => (
        <div
          key={summary.partner_id}
          className="flex items-center justify-between text-sm"
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: summary.color_hex }}
            />
            <span className="text-slate-500">
              {summary.display_name}
            </span>
            <span className="text-xs text-slate-400">
              ({summary.item_count} {summary.item_count === 1 ? "item" : "items"})
            </span>
          </div>
          <span className="font-mono text-sm tabular-nums">
            ${summary.total.toFixed(2)}
          </span>
        </div>
      ))}

      {/* Total */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <span className="text-sm font-semibold text-slate-900">Total</span>
        <span className="font-mono text-lg font-bold tabular-nums text-slate-900">
          ${total.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
