/**
 * @file expense-list.tsx
 * @description Lista de gastos registrados en la sesión de caja actual.
 *              Muestra cada gasto con su monto, descripción, tipo y distribución.
 *
 * FEATURES:
 * - Agrupa gastos por tipo (compartido/individual)
 * - Muestra la distribución por socia con badges de colores
 * - Muestra hora de registro
 * - Estado vacío amigable
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { Receipt, Users, User, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { getSessionExpensesLocalFirst } from "@/lib/local/cash-expenses";
import { PARTNERS } from "@/lib/constants";
import type { CashSession, Expense, ExpenseAllocation, Partner } from "@/types/database";

interface ExpenseWithAllocations extends Expense {
  expense_allocations: (ExpenseAllocation & {
    partner: Partner;
  })[];
}

interface ExpenseListProps {
  /** Sesión de caja activa */
  cashSession: CashSession | null;
  /** Partners */
  partners: Partner[];
  /** Trigger para recargar desde el padre */
  refreshTrigger?: number;
}

export function ExpenseList({
  cashSession,
  partners,
  refreshTrigger = 0,
}: ExpenseListProps) {
  const [expenses, setExpenses] = useState<ExpenseWithAllocations[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalExpenses, setTotalExpenses] = useState(0);

  const fetchExpenses = useCallback(async () => {
    if (!cashSession) {
      setExpenses([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const typed = (await getSessionExpensesLocalFirst(
        cashSession.id
      )) as unknown as ExpenseWithAllocations[];
      setExpenses(typed);
      setTotalExpenses(typed.reduce((sum, e) => sum + Number(e.amount), 0));
    } catch (err) {
      console.error("[ExpenseList] fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [cashSession]);

  // Recargar al montar y cuando cambie el trigger
  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses, refreshTrigger]);

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("es-EC", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex flex-col h-full rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-900">Gastos del Día</span>
          {expenses.length > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 text-amber-400"
            >
              {expenses.length}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {totalExpenses > 0 && (
            <span className="font-mono text-sm font-semibold text-amber-400">
              -${totalExpenses.toFixed(2)}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-slate-900 hover:bg-slate-100"
            onClick={fetchExpenses}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Lista */}
      <ScrollArea className="flex-1 px-3 py-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-[150px] text-slate-400">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[150px] text-slate-400 gap-2">
            <Receipt className="h-10 w-10 opacity-30" />
            <p className="text-sm">No hay gastos registrados</p>
            <p className="text-xs text-slate-400">
              Usa el botón &quot;Registrar Gasto&quot; para agregar uno
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {expenses.map((expense, index) => (
              <div
                key={expense.id}
                className="rounded-lg border border-slate-200 bg-white shadow-sm p-3 space-y-2 animate-[fade-in_0.3s_ease-out_forwards]"
                style={{
                  animationDelay: `${index * 80}ms`,
                  opacity: 0,
                }}
              >
                {/* Cabecera */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-md flex items-center justify-center ${
                        expense.scope === "shared"
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-violet-100 text-violet-700"
                      }`}
                    >
                      {expense.scope === "shared" ? (
                        <Users className="h-3 w-3" />
                      ) : (
                        <User className="h-3 w-3" />
                      )}
                    </div>
                    <span className="text-sm font-medium truncate">
                      {expense.description}
                    </span>
                  </div>
                  <span className="font-mono text-sm font-semibold text-amber-400 ml-2">
                    -${Number(expense.amount).toFixed(2)}
                  </span>
                </div>

                {/* Distribución */}
                <div className="flex items-center gap-1 flex-wrap">
                  {expense.expense_allocations.map((alloc) => {
                    const config =
                      PARTNERS[
                        alloc.partner.name as keyof typeof PARTNERS
                      ];
                    return (
                      <Badge
                        key={alloc.id}
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 h-5 border-opacity-30"
                        style={{
                          borderColor: config?.color,
                          color: config?.color,
                          backgroundColor: `${config?.color}10`,
                        }}
                      >
                        {alloc.partner.display_name}: $
                        {Number(alloc.amount).toFixed(2)}
                      </Badge>
                    );
                  })}
                </div>

                {/* Hora */}
                <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
                  <Clock className="h-3 w-3" />
                  {formatTime(expense.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Resumen por socia */}
      {expenses.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100 space-y-1.5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
            Total por socia
          </p>
          {partners.map((partner) => {
            const config =
              PARTNERS[partner.name as keyof typeof PARTNERS];
            const partnerTotal = expenses.reduce((sum, exp) => {
              const alloc = exp.expense_allocations.find(
                (a) => a.partner_id === partner.id
              );
              return sum + (alloc ? Number(alloc.amount) : 0);
            }, 0);

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
                <span className="font-mono text-amber-400/80">
                  -${partnerTotal.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
