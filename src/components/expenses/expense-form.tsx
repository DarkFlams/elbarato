/**
 * @file expense-form.tsx
 * @description Modal/formulario para registrar gastos.
 *
 * FLUJO:
 * 1. Ingresar monto y descripción del gasto
 * 2. Seleccionar tipo: Individual (una socia) o Compartido (las 3)
 * 3. Si individual → seleccionar a quién se le descuenta
 * 4. Si compartido → se divide entre 3 automáticamente
 * 5. Guardar en Supabase: tabla `expenses` + `expense_allocations`
 *
 * DISTRIBUCIÓN:
 * - Individual: 1 registro en expense_allocations con el monto total
 * - Compartido: 3 registros, cada uno con monto / 3
 */

"use client";

import { useState } from "react";
import { DollarSign, Users, User, Loader2 } from "lucide-react";
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
import { createClient } from "@/lib/supabase/client";
import { PARTNERS } from "@/lib/constants";
import type { CashSession, ExpenseScope, Partner } from "@/types/database";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ExpenseFormProps {
  /** Sesión de caja activa */
  cashSession: CashSession | null;
  /** Partners de la base de datos */
  partners: Partner[];
  /** Callback tras registrar gasto exitosamente */
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

  const resetForm = () => {
    setAmount("");
    setDescription("");
    setScope("shared");
    setSelectedPartnerId(null);
  };

  const handleSubmit = async () => {
    // Validaciones
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("Ingresa un monto válido");
      return;
    }
    if (!description.trim()) {
      toast.error("Ingresa una descripción");
      return;
    }
    if (!cashSession) {
      toast.error("No hay sesión de caja abierta");
      return;
    }
    if (scope === "individual" && !selectedPartnerId) {
      toast.error("Selecciona a quién pertenece el gasto");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // 1. Insertar gasto
      const { data: expense, error: expenseError } = await supabase
        .from("expenses")
        .insert({
          cash_session_id: cashSession.id,
          amount: numAmount,
          description: description.trim(),
          scope,
          registered_by: user?.id ?? null,
          synced: true,
        })
        .select()
        .single();

      if (expenseError) throw expenseError;

      // 2. Insertar asignaciones
      let allocations: { expense_id: string; partner_id: string; amount: number }[] = [];

      if (scope === "individual") {
        // Gasto individual: todo para una socia
        allocations = [
          {
            expense_id: expense.id,
            partner_id: selectedPartnerId!,
            amount: numAmount,
          },
        ];
      } else {
        // Gasto compartido: dividir entre 3
        const shareAmount = Math.round((numAmount / partners.length) * 100) / 100;
        const remainder = Math.round((numAmount - shareAmount * partners.length) * 100) / 100;

        allocations = partners.map((partner, index) => ({
          expense_id: expense.id,
          partner_id: partner.id,
          // Agregar el centavo de diferencia a la primera socia
          amount: index === 0 ? shareAmount + remainder : shareAmount,
        }));
      }

      const { error: allocError } = await supabase
        .from("expense_allocations")
        .insert(allocations);

      if (allocError) throw allocError;

      // 3. Éxito
      const scopeLabel =
        scope === "shared"
          ? `Compartido ($${(numAmount / partners.length).toFixed(2)} c/u)`
          : partners.find((p) => p.id === selectedPartnerId)?.display_name;

      toast.success(`Gasto registrado — $${numAmount.toFixed(2)}`, {
        description: `${description} • ${scopeLabel}`,
      });

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
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="bg-slate-900 hover:bg-slate-800 text-white shadow-md shadow-black/10 border-0 transition-all duration-200 focus-visible:ring-4 focus-visible:ring-slate-900/20 active:scale-[0.98]" />
        }
      >
        <DollarSign className="h-4 w-4 mr-2" />
        Registrar Gasto
      </DialogTrigger>

      <DialogContent className="sm:max-w-[425px] bg-white border-slate-200 shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-amber-400" />
            </div>
            Registrar Gasto
          </DialogTitle>
          <DialogDescription>
            Los gastos se descuentan de las ventas de cada socia al cierre.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Monto */}
          <div className="space-y-2">
            <Label htmlFor="expense-amount">Monto ($)</Label>
            <Input
              id="expense-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="font-mono text-lg h-12 bg-white border-slate-200 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/20"
            />
          </div>

          {/* Descripción */}
          <div className="space-y-2">
            <Label htmlFor="expense-desc">Descripción</Label>
            <Input
              id="expense-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Almuerzo, Limpieza, Bolsas..."
              className="bg-white border-slate-200 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/20"
            />
          </div>

          {/* Tipo de gasto */}
          <div className="space-y-2">
            <Label>¿De quién es el gasto?</Label>
            <div className="flex p-1 bg-slate-100 rounded-lg">
              <button
                onClick={() => {
                  setScope("shared");
                  setSelectedPartnerId(null);
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                  scope === "shared"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"
                )}
              >
                <Users className="h-4 w-4" />
                Compartido
              </button>
              <button
                onClick={() => setScope("individual")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                  scope === "individual"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"
                )}
              >
                <User className="h-4 w-4" />
                Individual
              </button>
            </div>
          </div>

          {/* Selector de socia (solo si es individual) */}
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
                        "flex flex-col items-center gap-1 px-3 py-3 rounded-lg border text-sm font-medium transition-all duration-200",
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
                              // @ts-expect-error CSS custom property
                              "--glow-color": `${config.color}30`,
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

          {/* Preview de distribución */}
          {amount && parseFloat(amount) > 0 && (
            <div className="rounded-lg border border-slate-100 bg-slate-50 shadow-sm p-3 space-y-1">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                Distribución
              </p>
              {scope === "shared" ? (
                partners.map((partner) => {
                  const config =
                    PARTNERS[partner.name as keyof typeof PARTNERS];
                  return (
                    <div
                      key={partner.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: config.color }}
                        />
                        <span className="text-slate-500">
                          {partner.display_name}
                        </span>
                      </div>
                      <span className="font-mono text-amber-600">
                        -${(parseFloat(amount) / partners.length).toFixed(2)}
                      </span>
                    </div>
                  );
                })
              ) : selectedPartnerId ? (
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">
                      {
                        partners.find((p) => p.id === selectedPartnerId)
                          ?.display_name
                      }
                    </span>
                  </div>
                  <span className="font-mono text-amber-600">
                    -${parseFloat(amount).toFixed(2)}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  Selecciona una socia para ver la distribución
                </p>
              )}
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
            className="bg-slate-900 hover:bg-slate-800 text-white shadow-md shadow-black/10 border-0 transition-all duration-200 focus-visible:ring-4 focus-visible:ring-slate-900/20"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Registrando...
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
