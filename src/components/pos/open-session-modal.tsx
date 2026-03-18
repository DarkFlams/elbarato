/**
 * @file open-session-modal.tsx
 * @description Modal obligatorio que aparece al entrar al POS sin una sesión de caja abierta.
 * Bloquea la interacción hasta que el usuario ingresa un monto inicial y abre la caja.
 */

"use client";

import { useState } from "react";
import { Calculator, Loader2, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCashSession } from "@/hooks/use-cash-session";
import { toast } from "sonner";

export function OpenSessionModal() {
  const { session, isLoading: sessionLoading, openSession } = useCashSession();
  const [openingCash, setOpeningCash] = useState<string>("0");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Si está cargando o ya hay sesión, no mostrar el modal
  if (sessionLoading || session) return null;

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const amount = parseFloat(openingCash);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Por favor ingresa un monto valido mayor o igual a 0", {
        description: "Usa punto para decimales (ej. 15.50)"
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const newSession = await openSession(amount);
      if (newSession) {
        toast.success(`Caja abierta con $${amount.toFixed(2)}`);
      }
    } catch {
      toast.error("Error inesperado al abrir la caja");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-[24px] bg-white p-1 shadow-2xl relative overflow-hidden">
        {/* Decoracion de fondo */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-2xl -ml-24 -mb-24 pointer-events-none" />

        <div className="relative p-6 sm:p-8">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <Calculator className="h-8 w-8 text-indigo-600" />
          </div>

          <div className="text-center mb-6">
            <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-indigo-900">
              Apertura de Caja
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Ingresa el efectivo disponible en caja para comenzar el día operativo.
            </p>
          </div>

          <form onSubmit={handleOpenSession} className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="openingCash" className="text-sm font-semibold text-slate-700 ml-1">
                Efectivo inicial en billetes y monedas
              </Label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  <DollarSign className="h-5 w-5 text-slate-400" />
                </div>
                <Input
                  id="openingCash"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                  className="pl-11 h-14 text-2xl font-mono border-slate-200 bg-white placeholder:text-slate-300 focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500 rounded-xl shadow-sm transition-all"
                  placeholder="0.00"
                  autoFocus
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-12 text-base font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-600/20 transition-all active:scale-[0.98]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Abriendo...
                </>
              ) : (
                "Abrir Caja Ahora"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
