/**
 * @file expenses-panel.tsx
 * @description Panel de gastos del día en la sidebar del POS.
 *              Muestra lista de gastos de la sesión activa y
 *              permite registrar gastos rápidos sin salir del POS.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Receipt,
  Plus,
  Users,
  User,
  Loader2,
  DollarSign,
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

interface ExpenseRow {
  id: string;
  amount: number;
  description: string;
  scope: ExpenseScope;
  created_at: string;
  expense_allocations?: { partner_id: string; partners: { display_name: string } | null }[];
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
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
          .select("id, amount, description, scope, created_at, expense_allocations(partner_id, partners(display_name))")
          .eq("cash_session_id", session.id)
          .order("created_at", { ascending: false }),
        supabase.from("partners").select("*").eq("is_expense_eligible", true).order("name"),
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
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("Ingresa un monto válido");
      return;
    }
    if (!description.trim()) {
      toast.error("Ingresa una descripción");
      return;
    }
    if (!session) {
      toast.error("No hay sesión de caja abierta");
      return;
    }
    if (scope === "individual" && !selectedPartnerId) {
      toast.error("Selecciona a quién pertenece el gasto");
      return;
    }

    setSubmitting(true);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: expense, error: expenseError } = await supabase
        .from("expenses")
        .insert({
          cash_session_id: session.id,
          amount: numAmount,
          description: description.trim(),
          scope,
          registered_by: user?.id ?? null,
          synced: true,
        })
        .select()
        .single();

      if (expenseError) throw expenseError;

      // Allocations
      let allocations: {
        expense_id: string;
        partner_id: string;
        amount: number;
      }[] = [];

      if (scope === "individual") {
        allocations = [
          {
            expense_id: expense.id,
            partner_id: selectedPartnerId!,
            amount: numAmount,
          },
        ];
      } else {
        const shareAmount =
          Math.round((numAmount / partners.length) * 100) / 100;
        const remainder =
          Math.round((numAmount - shareAmount * partners.length) * 100) / 100;
        allocations = partners.map((partner, index) => ({
          expense_id: expense.id,
          partner_id: partner.id,
          amount: index === 0 ? shareAmount + remainder : shareAmount,
        }));
      }

      const { error: allocError } = await supabase
        .from("expense_allocations")
        .insert(allocations);

      if (allocError) throw allocError;

      toast.success(`Gasto registrado — $${numAmount.toFixed(2)}`);

      // Reset form and refetch
      setAmount("");
      setDescription("");
      setScope("shared");
      setSelectedPartnerId(null);
      setShowForm(false);
      fetchData();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al registrar gasto";
      toast.error("Error al registrar gasto", { description: message });
    } finally {
      setSubmitting(false);
    }
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
          <h3 className="font-semibold text-slate-800 text-sm">
            Gastos del Día
          </h3>
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
          onClick={() => setShowForm(!showForm)}
          disabled={!session}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Nuevo
        </Button>
      </div>

      {/* Quick form */}
      {showForm && (
        <div className="px-4 py-3 border-b border-slate-100 bg-amber-50/30 space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Descripción..."
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
                const config =
                  PARTNERS[partner.name as keyof typeof PARTNERS];
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
                Registrando...
              </>
            ) : (
              "Registrar Gasto"
            )}
          </Button>
        </div>
      )}

      {/* Expenses list */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-slate-400 gap-2">
            <Receipt className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">
              Sin gastos registrados
            </p>
            <p className="text-xs text-slate-400 text-center">
              Usa el botón "Nuevo" para registrar un gasto rápido.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {expenses.map((exp) => (
              <div
                key={exp.id}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">
                    {exp.description}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatTime(exp.created_at)} ·{" "}
                    {exp.scope === "shared"
                      ? "Compartido"
                      : exp.expense_allocations?.[0]?.partners?.display_name ?? "Individual"}
                  </p>
                </div>
                <span className="font-mono text-sm font-bold text-amber-600 ml-3">
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
