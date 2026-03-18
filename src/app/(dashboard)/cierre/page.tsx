/**
 * @file cierre/page.tsx
 * @description Página de Cierre de Caja.
 *
 * FUNCIONALIDADES:
 * - Ver resumen de la sesión activa (ventas y gastos por socia)
 * - Ingresar monto de cierre para cuadre
 * - Cerrar sesión de caja
 * - Exportar reporte a Excel y PDF
 * - Ver historial de gastos del día
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  Loader2,
  Wifi,
  WifiOff,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useCashSession } from "@/hooks/use-cash-session";
import { createClient } from "@/lib/supabase/client";
import { PARTNERS } from "@/lib/constants";
import { exportToExcel, exportToPdf } from "@/lib/export-utils";
import type { ReportData, } from "@/lib/export-utils";
import type { CashSessionReport } from "@/types/database";
import { toast } from "sonner";

export default function CierrePage() {
  const {
    session,
    closeSession,
  } = useCashSession();

  const [reportData, setReportData] = useState<CashSessionReport[]>([]);
  const [expenses, setExpenses] = useState<
    { description: string; amount: number; scope: string; allocations: string; time: string }[]
  >([]);
  const [closingCash, setClosingCash] = useState("");
  const [notes, setNotes] = useState("");
  const [isClosing, setIsClosing] = useState(false);

  // Cargar datos del reporte
  const fetchReport = useCallback(async () => {
    if (!session) {
      return;
    }

    try {
      const supabase = createClient();

      // Datos de la vista de reporte
      const { data: report, error: reportError } = await supabase
        .from("v_cash_session_report")
        .select("*")
        .eq("session_id", session.id);

      if (reportError) throw reportError;
      setReportData((report as CashSessionReport[]) || []);

      // Gastos de la sesión
      const { data: expData } = await supabase
        .from("expenses")
        .select(
          `
          *,
          expense_allocations (
            amount,
            partner:partners!expense_allocations_partner_id_fkey (display_name)
          )
        `
        )
        .eq("cash_session_id", session.id)
        .order("created_at", { ascending: false });

      const formattedExpenses = (expData || []).map((e: Record<string, unknown>) => ({
        description: e.description as string,
        amount: Number(e.amount),
        scope: e.scope as string,
        allocations: ((e.expense_allocations as Array<{ partner: { display_name: string }; amount: number }>) || [])
          .map(
            (a) =>
              `${a.partner.display_name}: $${Number(a.amount).toFixed(2)}`
          )
          .join(", "),
        time: new Date(e.created_at as string).toLocaleTimeString("es-EC", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      }));

      setExpenses(formattedExpenses);
    } catch (err) {
      console.error("[CierrePage] fetchReport error:", err);
    }
  }, [session]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Calcular totales
  const totalSales = reportData.reduce(
    (s, r) => s + Number(r.total_sales),
    0
  );
  const totalExpenses = reportData.reduce(
    (s, r) => s + Number(r.total_expenses),
    0
  );
  const grandTotal = totalSales - totalExpenses;

  // Acción: cerrar caja
  const handleClose = async () => {
    setIsClosing(true);
    try {
      const success = await closeSession(
        closingCash ? parseFloat(closingCash) : undefined,
        notes || undefined
      );
      if (success) {
        toast.success("Caja cerrada exitosamente");
      }
    } finally {
      setIsClosing(false);
    }
  };

  // Preparar datos para exportar
  const buildExportData = (): ReportData => ({
    sessionId: session?.id || "",
    date: session
      ? new Date(session.opened_at).toLocaleDateString("es-EC")
      : new Date().toLocaleDateString("es-EC"),
    openedAt: session
      ? new Date(session.opened_at).toLocaleTimeString("es-EC", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    closedAt: session?.closed_at
      ? new Date(session.closed_at).toLocaleTimeString("es-EC", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null,
    openingCash: Number(session?.opening_cash || 0),
    partners: reportData.map((r) => ({
      name: r.partner,
      displayName: r.display_name,
      color: r.color_hex,
      totalSales: Number(r.total_sales),
      totalExpenses: Number(r.total_expenses),
      netTotal: Number(r.net_total),
      itemCount: 0,
    })),
    expenses,
    totalSales,
    totalExpenses,
    grandTotal,
  });

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900">
            <ClipboardCheck className="h-5 w-5 text-indigo-600" />
            Cierre de Caja
          </h1>
          <p className="text-sm text-slate-500">
            {session
              ? `Sesión abierta desde ${new Date(session.opened_at).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}`
              : "No hay sesión activa"}
          </p>
        </div>

        <Badge
          variant="outline"
          className={
            session
              ? "border-emerald-200 text-emerald-700 bg-emerald-50"
              : "border-slate-200 text-slate-600 bg-slate-50"
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
              Cerrada
            </>
          )}
        </Badge>
      </div>

      {/* Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 min-h-0 overflow-auto">
        {/* Main: Reporte */}
        <div className="space-y-4">
          {/* Cards de resumen por socia */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {reportData.map((report) => {
              const config =
                PARTNERS[report.partner as keyof typeof PARTNERS];
              return (
                <div
                  key={report.partner}
                  className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3"
                  style={{
                    borderTopWidth: "3px",
                    borderTopColor: config?.color || "#666",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{config?.emoji}</span>
                    <span className="text-sm font-semibold text-slate-900">
                      {report.display_name}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500 flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-emerald-600" />
                        Ventas
                      </span>
                      <span className="font-mono font-semibold text-emerald-600">
                        ${Number(report.total_sales).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500 flex items-center gap-1">
                        <TrendingDown className="h-3 w-3 text-amber-500" />
                        Gastos
                      </span>
                      <span className="font-mono font-semibold text-amber-600">
                        -${Number(report.total_expenses).toFixed(2)}
                      </span>
                    </div>
                    <div className="border-t border-slate-100 pt-1 mt-1 flex justify-between text-sm">
                      <span className="font-medium text-slate-700">Neto</span>
                      <span className="font-mono font-bold text-slate-900">
                        ${Number(report.net_total).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totales generales */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-slate-500 mb-1">
                  Total Ventas
                </p>
                <p className="font-mono text-xl font-bold text-emerald-600">
                  ${totalSales.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">
                  Total Gastos
                </p>
                <p className="font-mono text-xl font-bold text-amber-600">
                  -${totalExpenses.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Neto Total</p>
                <p className="font-mono text-xl font-bold text-indigo-600">
                  ${grandTotal.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          {/* Gastos del día */}
          {expenses.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-900">
                <TrendingDown className="h-4 w-4 text-amber-500" />
                Gastos del Día
              </h3>
              <div className="space-y-2">
                {expenses.map((exp, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-slate-50 border border-slate-100"
                  >
                    <div>
                      <span className="font-medium text-slate-900">{exp.description}</span>
                      <span className="text-xs text-slate-500 ml-2">
                        ({exp.scope === "shared" ? "Compartido" : "Individual"})
                      </span>
                    </div>
                    <span className="font-mono text-amber-600 flex items-center gap-1 font-medium">
                      -${exp.amount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Acciones */}
        <div className="space-y-4">
          {/* Export */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-900">
              <Download className="h-4 w-4 text-slate-400" />
              Exportar Reporte
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="border-slate-200 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 bg-white"
                onClick={() => exportToExcel(buildExportData())}
                disabled={reportData.length === 0}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Excel
              </Button>
              <Button
                variant="outline"
                className="border-slate-200 text-slate-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 bg-white"
                onClick={() => exportToPdf(buildExportData())}
                disabled={reportData.length === 0}
              >
                <FileText className="h-4 w-4 mr-2" />
                PDF
              </Button>
            </div>
          </div>

          {/* Cerrar caja */}
          {session && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-900">
                <Lock className="h-4 w-4 text-rose-500" />
                Cerrar Caja
              </h3>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="closing-cash">
                    Efectivo al cierre ($)
                  </Label>
                  <Input
                    id="closing-cash"
                    type="number"
                    step="0.01"
                    min="0"
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                    placeholder="Contar y escribir el total"
                    className="font-mono bg-white border-slate-200 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="closing-notes">
                    Notas{" "}
                    <span className="text-slate-400">(opcional)</span>
                  </Label>
                  <Input
                    id="closing-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Observaciones del día..."
                    className="bg-white border-slate-200 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/20"
                  />
                </div>

                {/* Cuadre */}
                {closingCash && (
                  <div className="rounded-lg border border-slate-100 bg-slate-50 shadow-sm p-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Esperado</span>
                      <span className="font-mono text-slate-900">
                        $
                        {(
                          Number(session.opening_cash) + grandTotal
                        ).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Contado</span>
                      <span className="font-mono text-slate-900">
                        ${parseFloat(closingCash).toFixed(2)}
                      </span>
                    </div>
                    <div className="border-t border-slate-200 pt-1 mt-1 flex justify-between text-sm">
                      <span className="font-medium text-slate-700">Diferencia</span>
                      <span
                        className={`font-mono font-bold ${
                          parseFloat(closingCash) -
                            (Number(session.opening_cash) + grandTotal) >=
                          0
                            ? "text-emerald-600"
                            : "text-rose-600"
                        }`}
                      >
                        $
                        {(
                          parseFloat(closingCash) -
                          (Number(session.opening_cash) + grandTotal)
                        ).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleClose}
                  disabled={isClosing}
                  className="w-full bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20 border-0"
                >
                  {isClosing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Cerrando...
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4 mr-2" />
                      Cerrar Caja
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
