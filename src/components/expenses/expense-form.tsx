"use client";

import { useRef, useState } from "react";
import { DollarSign, Loader2, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PARTNERS } from "@/lib/constants";
import type { CashSession, ExpenseScope, Partner } from "@/types/database";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { upsertExpenseWithOfflineFallback } from "@/lib/offline/rpc";

interface ExpenseFormProps {
  cashSession: CashSession | null;
  partners: Partner[];
  onExpenseRegistered?: () => void;
}

export function ExpenseForm({
  cashSession,
  partners,
  onExpenseRegistered,
}: ExpenseFormProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<ExpenseScope>("shared");
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);
  const expenseRequestKeyRef = useRef<string | null>(null);

  const resetForm = () => {
    setAmount("");
    setDescription("");
    setScope("shared");
    setSelectedPartnerId(null);
    expenseRequestKeyRef.current = null;
  };

  const handleSubmit = async () => {
    if (submitInFlightRef.current || isSubmitting) return;

    const numAmount = Number.parseFloat(amount);
    if (Number.isNaN(numAmount) || numAmount <= 0) {
      toast.error("Ingresa un monto valido");
      return;
    }
    if (!description.trim()) {
      toast.error("Ingresa una descripcion");
      return;
    }
    if (!cashSession) {
      toast.error("No hay sesion de caja abierta");
      return;
    }
    if (scope === "individual" && !selectedPartnerId) {
      toast.error("Selecciona a quien pertenece el gasto");
      return;
    }
    if (scope === "shared" && partners.length === 0) {
      toast.error("No hay socias disponibles para dividir el gasto");
      return;
    }

    const requestKey =
      expenseRequestKeyRef.current ??
      (globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    expenseRequestKeyRef.current = requestKey;
    submitInFlightRef.current = true;
    setIsSubmitting(true);

    try {
      const saveResult = await upsertExpenseWithOfflineFallback({
        p_expense_id: null,
        p_cash_session_id: cashSession.id,
        p_amount: numAmount,
        p_description: description.trim(),
        p_scope: scope,
        p_partner_id: scope === "individual" ? selectedPartnerId : null,
        p_shared_partner_ids:
          scope === "shared" ? partners.map((partner) => partner.id) : null,
        p_idempotency_key: requestKey,
      });

      const scopeLabel =
        scope === "shared"
          ? `Compartido ($${(numAmount / partners.length).toFixed(2)} c/u)`
          : partners.find((p) => p.id === selectedPartnerId)?.display_name ??
            "Individual";

      if (saveResult.mode === "queued") {
        toast.warning(`Gasto guardado offline - $${numAmount.toFixed(2)}`, {
          description: `${description} - ${scopeLabel} - pendiente de sincronizacion`,
        });
      } else {
        toast.success(`Gasto registrado - $${numAmount.toFixed(2)}`, {
          description: `${description} - ${scopeLabel}`,
        });
      }

      resetForm();
      setOpen(false);
      onExpenseRegistered?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al registrar gasto";
      toast.error("Error al registrar gasto", { description: message });
      console.error("[ExpenseForm] submit error:", err);
    } finally {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="bg-slate-900 text-white shadow-md shadow-black/10 transition-all duration-200 hover:bg-slate-800 focus-visible:ring-4 focus-visible:ring-slate-900/20 active:scale-[0.98]" />
        }
      >
        <DollarSign className="mr-2 h-4 w-4" />
        Registrar Gasto
      </DialogTrigger>

      <DialogContent className="border-slate-200 bg-white shadow-xl sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20">
              <DollarSign className="h-4 w-4 text-amber-400" />
            </div>
            Registrar Gasto
          </DialogTitle>
          <DialogDescription>
            Los gastos se descuentan de las ventas al cierre de caja.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="expense-amount">Monto ($)</Label>
            <Input
              id="expense-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              className="h-12 border-slate-200 bg-white font-mono text-lg shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/20"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-desc">Descripcion</Label>
            <Input
              id="expense-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Ej: Almuerzo, Limpieza, Bolsas..."
              className="border-slate-200 bg-white shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/20"
            />
          </div>

          <div className="space-y-2">
            <Label>De quien es el gasto?</Label>
            <div className="flex rounded-lg bg-slate-100 p-1">
              <button
                onClick={() => {
                  setScope("shared");
                  setSelectedPartnerId(null);
                }}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200",
                  scope === "shared"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-700"
                )}
              >
                <Users className="h-4 w-4" />
                Compartido
              </button>
              <button
                onClick={() => setScope("individual")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200",
                  scope === "individual"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-700"
                )}
              >
                <User className="h-4 w-4" />
                Individual
              </button>
            </div>
          </div>

          {scope === "individual" && (
            <div className="space-y-2">
              <Label>Selecciona la socia</Label>
              <div className="grid grid-cols-3 gap-2">
                {partners.map((partner) => {
                  const config =
                    PARTNERS[partner.name as keyof typeof PARTNERS];
                  const isSelected = selectedPartnerId === partner.id;

                  return (
                    <button
                      key={partner.id}
                      onClick={() => setSelectedPartnerId(partner.id)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-lg border px-3 py-3 text-sm font-medium transition-all duration-200",
                        isSelected
                          ? "shadow-sm shadow-indigo-500/20"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                      )}
                      style={
                        isSelected
                          ? {
                              borderColor: config.color,
                              backgroundColor: `${config.color}15`,
                              color: config.color,
                            }
                          : undefined
                      }
                    >
                      <span className="text-lg">{config.emoji}</span>
                      <span>{partner.display_name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              resetForm();
              setOpen(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !cashSession}
            className="border-0 bg-slate-900 text-white shadow-md shadow-black/10 transition-all duration-200 hover:bg-slate-800 focus-visible:ring-4 focus-visible:ring-slate-900/20"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              "Registrar Gasto"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
