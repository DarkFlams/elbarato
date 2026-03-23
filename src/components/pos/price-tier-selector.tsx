"use client";

import { cn } from "@/lib/utils";
import { PRICE_TIER_OPTIONS, getTierLabel } from "@/lib/pricing";
import { useCart } from "@/hooks/use-cart";

export function PriceTierSelector() {
  const { selectedPriceTier, setSelectedPriceTier } = useCart();

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Precio
      </span>
      <div className="inline-flex items-center rounded-md border border-slate-200 bg-white p-0.5 shadow-sm">
        {PRICE_TIER_OPTIONS.map((option) => {
          const isActive = option.value === selectedPriceTier;
          return (
            <button
              key={option.value}
              type="button"
              title={getTierLabel(option.value)}
              onClick={() => setSelectedPriceTier(option.value)}
              className={cn(
                "rounded px-2 py-1 text-[11px] font-bold transition-colors",
                isActive
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              {option.value === "normal" ? "N" : option.shortLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
