/**
 * @file payment-selector.tsx
 * @description Selector de método de pago: Efectivo o Transferencia.
 *              Botones grandes con iconos para selección rápida.
 */

"use client";

import { Banknote, ArrowRightLeft } from "lucide-react";
import { useCart } from "@/hooks/use-cart";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/types/database";

const PAYMENT_OPTIONS: {
  value: PaymentMethod;
  label: string;
  icon: React.ElementType;
}[] = [
  { value: "cash", label: "Efectivo", icon: Banknote },
  { value: "transfer", label: "Transferencia", icon: ArrowRightLeft },
];

export function PaymentSelector() {
  const { paymentMethod, setPaymentMethod } = useCart();

  return (
    <div className="grid grid-cols-2 gap-2">
      {PAYMENT_OPTIONS.map((option) => {
        const isSelected = paymentMethod === option.value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            onClick={() => setPaymentMethod(option.value)}
            className={cn(
              "flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all duration-200",
              isSelected
                ? "border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm ring-1 ring-indigo-600/20"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700"
            )}
          >
            <Icon className="h-4 w-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
