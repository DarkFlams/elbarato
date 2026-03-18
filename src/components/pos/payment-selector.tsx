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

        // Distinct colors for each payment method
        const selectedClass =
          option.value === "cash"
            ? "border-emerald-600 bg-emerald-50 text-emerald-700 shadow-sm ring-1 ring-emerald-600/20"
            : "border-sky-600 bg-sky-50 text-sky-700 shadow-sm ring-1 ring-sky-600/20";

        return (
          <button
            key={option.value}
            onClick={() => setPaymentMethod(option.value)}
            className={cn(
              "flex flex-col items-center justify-center gap-2 px-3 py-4 rounded-xl border text-sm font-semibold transition-all duration-200",
              isSelected
                ? selectedClass
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700"
            )}
          >
            <Icon className="h-6 w-6" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
