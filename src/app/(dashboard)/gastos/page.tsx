/**
 * @file gastos/page.tsx
 * @description Página principal de gestión de gastos.
 *
 * LAYOUT:
 * - Header con título, sesión activa y botón "Registrar Gasto"
 * - 2 columnas en desktop: lista de gastos | resumen rápido por socia
 * - Mobile: columna única con lista + resumen apilados
 *
 * FEATURES:
 * - Formulario modal para registrar gastos (individual/compartido)
 * - Lista en tiempo real de gastos de la sesión actual
 * - Resumen de distribución por socia
 * - Auto-refresh al registrar un nuevo gasto
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { Wallet, Wifi, WifiOff, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useCashSession } from "@/hooks/use-cash-session";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseList } from "@/components/expenses/expense-list";
import { createClient } from "@/lib/supabase/client";
import { PARTNERS } from "@/lib/constants";
import type { Partner } from "@/types/database";

export default function GastosPage() {
  const { session, isLoading: sessionLoading } = useCashSession();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Cargar partners de Supabase
  const fetchPartners = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("partners")
        .select("*")
        .order("name");

      if (error) throw error;
      setPartners((data as Partner[]) || []);
    } catch (err) {
      console.error("[GastosPage] fetchPartners error:", err);
    }
  }, []);

  useEffect(() => {
    fetchPartners();
  }, [fetchPartners]);

  const handleExpenseRegistered = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900">
            <Wallet className="h-5 w-5 text-amber-500" />
            Control de Gastos
          </h1>
          <p className="text-sm text-slate-500">
            Registra gastos individuales o compartidos entre las socias
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className={
              session
                ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                : "border-amber-200 text-amber-700 bg-amber-50"
            }
          >
            {session ? (
              <>
                <Wifi className="h-3 w-3 mr-1" />
                Sesión activa
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 mr-1" />
                {sessionLoading ? "Cargando..." : "Sin sesión"}
              </>
            )}
          </Badge>

          <ExpenseForm
            cashSession={session}
            partners={partners}
            onExpenseRegistered={handleExpenseRegistered}
          />
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 min-h-0">
        {/* Columna principal: Lista de gastos */}
        <ExpenseList
          cashSession={session}
          partners={partners}
          refreshTrigger={refreshTrigger}
        />

        {/* Columna lateral: Resumen visual */}
        <div className="hidden lg:flex flex-col gap-4">
          {/* Card de resumen */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-semibold text-slate-900">Cómo funciona</span>
            </div>

            <div className="space-y-3 text-sm text-slate-500">
              <div className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                  1
                </span>
                <p>
                  <strong className="text-slate-900">Gasto compartido:</strong> Se
                  divide entre las 3 socias automáticamente.
                </p>
              </div>

              <div className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold shrink-0">
                  2
                </span>
                <p>
                  <strong className="text-slate-900">Gasto individual:</strong> Se
                  descuenta completo de una sola socia.
                </p>
              </div>

              <div className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-xs font-bold shrink-0">
                  3
                </span>
                <p>
                  Al <strong className="text-slate-900">cerrar caja</strong>, los
                  gastos se restan de las ventas para calcular el neto.
                </p>
              </div>
            </div>
          </div>

          {/* Quick-stats por socia */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Socias del negocio
            </p>
            {partners.length > 0 ? (
              partners.map((partner) => {
                const config =
                  PARTNERS[partner.name as keyof typeof PARTNERS];
                return (
                  <div
                    key={partner.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50"
                    style={{
                      borderLeftWidth: "3px",
                      borderLeftColor: config.color,
                    }}
                  >
                    <span className="text-lg">{config.emoji}</span>
                    <span className="text-sm font-medium">
                      {partner.display_name}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-slate-400">
                Las socias se cargarán de la base de datos
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
