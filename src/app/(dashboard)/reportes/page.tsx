/**
 * @file reportes/page.tsx
 * @description Pagina de reportes historicos.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  Clock,
  TrendingUp,
  TrendingDown,
  FilterX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { PARTNERS } from "@/lib/constants";
import { exportToExcel, exportToPdf } from "@/lib/export-utils";
import type { ReportData } from "@/lib/export-utils";
import type { CashSession, CashSessionReport } from "@/types/database";

interface SessionWithReport extends CashSession {
  report?: CashSessionReport[];
  expenses?: {
    description: string;
    amount: number;
    scope: string;
    allocations: string;
    time: string;
  }[];
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function ReportesPage() {
  const [sessions, setSessions] = useState<SessionWithReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const supabase = createClient();
      let query = supabase
        .from("cash_sessions")
        .select("*")
        .order("opened_at", { ascending: false });

      if (fromDate) {
        query = query.gte("opened_at", `${fromDate}T00:00:00`);
      }

      if (toDate) {
        query = query.lte("opened_at", `${toDate}T23:59:59.999`);
      }

      if (!fromDate && !toDate) {
        query = query.limit(30);
      }

      const { data, error } = await query;

      if (error) throw error;
      setSessions((data as CashSession[]) || []);
    } catch (err) {
      console.error("[ReportesPage] fetchSessions error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const setPresetRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));

    setFromDate(formatDateInput(start));
    setToDate(formatDateInput(end));
  };

  const clearFilters = () => {
    setFromDate("");
    setToDate("");
  };

  const toggleSession = async (sessionId: string) => {
    if (expandedSession === sessionId) {
      setExpandedSession(null);
      return;
    }

    setExpandedSession(sessionId);

    const session = sessions.find((s) => s.id === sessionId);
    if (session?.report) return;

    try {
      const supabase = createClient();

      const { data: report } = await supabase
        .from("v_cash_session_report")
        .select("*")
        .eq("session_id", sessionId);

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
        .eq("cash_session_id", sessionId)
        .order("created_at", { ascending: false });

      const formattedExpenses = (expData || []).map((e: Record<string, unknown>) => ({
        description: e.description as string,
        amount: Number(e.amount),
        scope: e.scope as string,
        allocations: (
          (e.expense_allocations as Array<{
            partner: { display_name: string };
            amount: number;
          }>) || []
        )
          .map((a) => `${a.partner.display_name}: $${Number(a.amount).toFixed(2)}`)
          .join(", "),
        time: new Date(e.created_at as string).toLocaleTimeString("es-EC", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      }));

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                report: (report as CashSessionReport[]) || [],
                expenses: formattedExpenses,
              }
            : s
        )
      );
    } catch (err) {
      console.error("[ReportesPage] toggleSession error:", err);
    }
  };

  const buildExportData = (session: SessionWithReport): ReportData => {
    const report = session.report || [];
    const totalSales = report.reduce((s, r) => s + Number(r.total_sales), 0);
    const totalExpenses = report.reduce(
      (s, r) => s + Number(r.total_expenses),
      0
    );

    return {
      sessionId: session.id,
      date: new Date(session.opened_at).toLocaleDateString("es-EC"),
      openedAt: new Date(session.opened_at).toLocaleTimeString("es-EC", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      closedAt: session.closed_at
        ? new Date(session.closed_at).toLocaleTimeString("es-EC", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : null,
      openingCash: Number(session.opening_cash || 0),
      partners: report.map((r) => ({
        name: r.partner,
        displayName: r.display_name,
        color: r.color_hex,
        totalSales: Number(r.total_sales),
        totalExpenses: Number(r.total_expenses),
        netTotal: Number(r.net_total),
        itemCount: 0,
      })),
      expenses: session.expenses || [],
      totalSales,
      totalExpenses,
      grandTotal: totalSales - totalExpenses,
    };
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("es-EC", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });

  const formatTime = (d: string) =>
    new Date(d).toLocaleTimeString("es-EC", {
      hour: "2-digit",
      minute: "2-digit",
    });

  const hasFilters = Boolean(fromDate || toDate);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] gap-4">
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900">
            <BarChart3 className="h-5 w-5 text-indigo-600" />
            Reportes Historicos
          </h1>
          <p className="text-sm text-slate-500">
            Revisa sesiones de caja y filtralas por rango de fechas
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-white border-slate-200 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/20"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-white border-slate-200 shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/20"
            />
            <Button
              variant="outline"
              className="border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              onClick={clearFilters}
              disabled={!hasFilters}
            >
              <FilterX className="h-4 w-4 mr-2" />
              Limpiar
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setPresetRange(1)}
            >
              Hoy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setPresetRange(7)}
            >
              7 dias
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setPresetRange(30)}
            >
              30 dias
            </Button>
            <span className="text-xs text-slate-400 self-center ml-auto">
              {hasFilters
                ? "Mostrando sesiones filtradas"
                : "Mostrando las 30 sesiones mas recientes"}
            </span>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-[200px] text-slate-500">
            <Clock className="h-5 w-5 animate-spin mr-2" />
            Cargando sesiones...
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[200px] text-slate-400 gap-2">
            <BarChart3 className="h-10 w-10 opacity-30" />
            <p className="text-sm">
              {hasFilters
                ? "No hay sesiones en el rango seleccionado"
                : "No hay sesiones registradas"}
            </p>
          </div>
        ) : (
          <div className="space-y-3 pr-2">
            {sessions.map((session) => {
              const isExpanded = expandedSession === session.id;
              const report = session.report || [];
              const totalSales = report.reduce(
                (s, r) => s + Number(r.total_sales),
                0
              );
              const totalExpenses = report.reduce(
                (s, r) => s + Number(r.total_expenses),
                0
              );

              return (
                <div
                  key={session.id}
                  className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
                >
                  <button
                    onClick={() => toggleSession(session.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-slate-500" />
                        <span className="text-sm font-semibold text-slate-900">
                          {formatDate(session.opened_at)}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">
                        {formatTime(session.opened_at)}
                        {session.closed_at && ` - ${formatTime(session.closed_at)}`}
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          session.status === "open"
                            ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                            : "border-slate-200 text-slate-600 bg-slate-100"
                        }
                      >
                        {session.status === "open" ? "Abierta" : "Cerrada"}
                      </Badge>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                      {report.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-slate-500 text-sm">
                          <Clock className="h-4 w-4 animate-spin mr-2" />
                          Cargando reporte...
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {report.map((r) => {
                              const config =
                                PARTNERS[r.partner as keyof typeof PARTNERS];

                              return (
                                <div
                                  key={r.partner}
                                  className="rounded-lg border border-slate-200 bg-slate-50 shadow-sm p-3"
                                  style={{
                                    borderLeftWidth: "3px",
                                    borderLeftColor: config?.color || "#666",
                                  }}
                                >
                                  <p className="text-xs text-slate-500 mb-1">
                                    {r.display_name}
                                  </p>
                                  <div className="flex items-baseline gap-2">
                                    <span className="font-mono text-sm font-semibold text-emerald-600">
                                      +${Number(r.total_sales).toFixed(2)}
                                    </span>
                                    <span className="font-mono text-xs text-amber-600">
                                      -${Number(r.total_expenses).toFixed(2)}
                                    </span>
                                    <span className="font-mono text-sm font-bold ml-auto text-slate-900">
                                      =${Number(r.net_total).toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4 text-sm">
                              <span className="text-slate-500">
                                <TrendingUp className="h-3 w-3 inline mr-1 text-emerald-600" />
                                ${totalSales.toFixed(2)}
                              </span>
                              <span className="text-slate-500">
                                <TrendingDown className="h-3 w-3 inline mr-1 text-amber-600" />
                                ${totalExpenses.toFixed(2)}
                              </span>
                              <span className="font-semibold text-slate-900">
                                Neto: ${(totalSales - totalExpenses).toFixed(2)}
                              </span>
                            </div>

                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
                                onClick={() =>
                                  exportToExcel(buildExportData(session))
                                }
                              >
                                <FileSpreadsheet className="h-3 w-3 mr-1" />
                                Excel
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
                                onClick={() =>
                                  exportToPdf(buildExportData(session))
                                }
                              >
                                <FileText className="h-3 w-3 mr-1" />
                                PDF
                              </Button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
