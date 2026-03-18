/**
 * @file expenses-panel.tsx
 * @description Panel de gastos del dia en la sidebar del POS.
 *              Muestra lista de gastos de la sesion activa y
 *              permite registrar gastos rapidos sin salir del POS.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Receipt,
  Plus,
  Users,
  User,
  Loader2,
  DollarSign,
  PencilLine,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createClient } from "@/lib/supabase/client";
import { useCashSession } from "@/hooks/use-cash-session";
import { PARTNERS } from "@/lib/constants";
import type { Partner, ExpenseScope } from "@/types/database";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { upsertExpenseWithOfflineFallback } from "@/lib/offline/rpc";

interface ExpenseRow {
  id: string;
  amount: number;
  description: string;
  scope: ExpenseScope;
  created_at: string;
  expense_allocations?: {
    partner_id: string;
    partners: { display_name: string } | null;
  }[];
}

export function ExpensesPanel() {
  const { session } = useCashSession();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalExpenses, setTotalExpenses] = useState(0);

  // Quick form state
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<ExpenseScope>("shared");
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null);
  const submitInFlightRef = useRef(false);
  const createRequestKeyRef = useRef<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!session?.id) {
      setExpenses([]);
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();

      const [expensesRes, partnersRes] = await Promise.all([
        supabase
          .from("expenses")
          .select(
            "id, amount, description, scope, created_at, expense_allocations(partner_id, partners(display_name))"
          )
          .eq("cash_session_id", session.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("partners")
          .select("*")
          .eq("is_expense_eligible", true)
          .order("name"),
      ]);

      if (expensesRes.data) {
        const rows = expensesRes.data as ExpenseRow[];
        setExpenses(rows);
        setTotalExpenses(
          rows.reduce((sum: number, e: ExpenseRow) => sum + Number(e.amount), 0)
        );
      }
      if (partnersRes.data) setPartners(partnersRes.data as Partner[]);
    } catch (err) {
      console.error("[ExpensesPanel] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [session?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSubmit = async () => {
    if (submitInFlightRef.current || submitting) return;

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("Ingresa un monto valido");
      return;
    }
    if (!description.trim()) {
      toast.error("Ingresa una descripcion");
      return;
    }
    if (!session) {
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
      createRequestKeyRef.current ??
      (globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    if (!editingExpense) {
      createRequestKeyRef.current = requestKey;
    }

    submitInFlightRef.current = true;
    setSubmitting(true);

    try {
      const saveResult = await upsertExpenseWithOfflineFallback({
        p_expense_id: editingExpense?.id ?? null,
        p_cash_session_id: session.id,
        p_amount: numAmount,
        p_description: description.trim(),
        p_scope: scope,
        p_partner_id: scope === "individual" ? selectedPartnerId : null,
        p_shared_partner_ids:
          scope === "shared" ? partners.map((partner) => partner.id) : null,
        p_idempotency_key: editingExpense ? null : requestKey,
      });

      if (saveResult.mode === "queued") {
        toast.warning(`Gasto guardado offline - $${numAmount.toFixed(2)}`, {
          description:
            "Pendiente de sincronizacion. Se enviara al volver internet.",
        });
      } else {
        toast.success(
          editingExpense
            ? "Gasto actualizado"
            : `Gasto registrado - $${numAmount.toFixed(2)}`
        );
      }

      setAmount("");
      setDescription("");
      setScope("shared");
      setSelectedPartnerId(null);
      setEditingExpense(null);
      setShowForm(false);
      createRequestKeyRef.current = null;
      fetchData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al guardar gasto";
      toast.error("Error al guardar gasto", { description: message });
    } finally {
      setSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  const handleEditClick = (exp: ExpenseRow) => {
    setEditingExpense(exp);
    setAmount(exp.amount.toString());
    setDescription(exp.description);
    setScope(exp.scope);
    if (exp.scope === "individual" && exp.expense_allocations?.length) {
      setSelectedPartnerId(exp.expense_allocations[0].partner_id);
    } else {
      setSelectedPartnerId(null);
    }
    setShowForm(true);
  };

  const resetForm = () => {
    setAmount("");
    setDescription("");
    setScope("shared");
    setSelectedPartnerId(null);
    setEditingExpense(null);
    setShowForm(false);
    createRequestKeyRef.current = null;
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("es-EC", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex flex-col flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-2">
          <Receipt className="h-4.5 w-4.5 text-amber-600" />
          <h3 className="font-semibold text-slate-800 text-sm">Gastos del Dia</h3>
          {expenses.length > 0 && (
            <span className="text-xs font-mono font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              -${totalExpenses.toFixed(2)}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs font-semibold text-slate-500 hover:text-amber-700 hover:bg-amber-50"
          onClick={() => {
            if (showForm) {
              resetForm();
            } else {
              setShowForm(true);
            }
          }}
          disabled={!session}
        >
          {showForm ? (
            <>
              <X className="h-3.5 w-3.5 mr-1" /> Cerrar
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5 mr-1" /> Nuevo
            </>
          )}
        </Button>
      </div>

      {/* Quick form */}
      {showForm && (
        <div className="px-4 py-3 border-b border-slate-100 bg-amber-50/30 space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Descripcion..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex-1 h-9 text-sm bg-white"
            />
            <div className="relative w-24">
              <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9 pl-7 text-sm font-mono font-bold bg-white"
              />
            </div>
          </div>

          {/* Scope toggle */}
          <div className="flex gap-1 bg-slate-100 rounded-md p-0.5">
            <button
              onClick={() => {
                setScope("shared");
                setSelectedPartnerId(null);
              }}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition-all",
                scope === "shared"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Users className="h-3 w-3" />
              Compartido
            </button>
            <button
              onClick={() => setScope("individual")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition-all",
                scope === "individual"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <User className="h-3 w-3" />
              Individual
            </button>
          </div>

          {/* Partner selector (individual) */}
          {scope === "individual" && (
            <div className="flex gap-1.5">
              {partners.map((partner) => {
                const config = PARTNERS[partner.name as keyof typeof PARTNERS];
                const isSelected = selectedPartnerId === partner.id;
                return (
                  <button
                    key={partner.id}
                    onClick={() => setSelectedPartnerId(partner.id)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1 py-2 rounded-md border text-xs font-semibold transition-all",
                      isSelected
                        ? "shadow-sm"
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
                    <span>{config.emoji}</span>
                    {partner.display_name}
                  </button>
                );
              })}
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={submitting || !session}
            className="w-full h-9 text-sm bg-slate-800 hover:bg-slate-900 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Guardando...
              </>
            ) : editingExpense ? (
              "Guardar Cambios"
            ) : scope === "individual" && selectedPartnerId ? (
              `Confirmar Gasto para ${
                partners.find((p) => p.id === selectedPartnerId)?.display_name
              }`
            ) : scope === "shared" ? (
              "Registrar Gasto Compartido"
            ) : (
              "Registrar Gasto"
            )}
          </Button>
        </div>
      )}

      {/* Listado de Gastos */}
      <ScrollArea className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-slate-400 gap-2">
            <Receipt className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">Sin gastos registrados</p>
            <p className="text-xs text-slate-400 text-center">
              Usa el boton Nuevo para registrar un gasto rapido.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {expenses.map((exp) => (
              <div
                key={exp.id}
                onClick={() => handleEditClick(exp)}
                className="group flex items-center justify-between px-4 py-3 hover:bg-amber-50/50 cursor-pointer transition-colors"
                title="Haz clic para modificar o reasignar"
              >
                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-slate-700 truncate group-hover:text-amber-800 transition-colors">
                      {exp.description}
                    </p>
                    <PencilLine className="h-3 w-3 text-slate-300 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </div>
                  <p className="text-xs text-slate-400">
                    {formatTime(exp.created_at)}{" - "}
                    {exp.scope === "shared"
                      ? "Compartido"
                      : exp.expense_allocations?.[0]?.partners?.display_name ??
                        "Individual"}
                  </p>
                </div>
                <span className="font-mono text-sm font-bold text-amber-600 ml-3 shrink-0">
                  -${Number(exp.amount).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
