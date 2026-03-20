/**
 * @file session-stats.tsx
 * @description Panel lateral del POS con estadisticas del dia operativo.
 */

"use client";

import { useEffect, useState, useRef } from "react";
import { Calculator, Clock, TrendingUp, Eye, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCashSession } from "@/hooks/use-cash-session";
import { getSessionSalesStatsLocalFirst } from "@/lib/local/sales";

interface LiveStats {
  totalVentas: number;
  totalEfectivo: number;
  totalTransferencia: number;
  cantidadVentas: number;
}

export function SessionStats() {
  const { session } = useCashSession();
  const [stats, setStats] = useState<LiveStats>({
    totalVentas: 0,
    totalEfectivo: 0,
    totalTransferencia: 0,
    cantidadVentas: 0,
  });
  const [showStats, setShowStats] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!session) return;
    // (Intervalo removido ya que se eliminó el contador de tiempo)
  }, [session]);

  useEffect(() => {
    if (!session?.id) return;

    const fetchStats = async () => {
      try {
        const localStats = await getSessionSalesStatsLocalFirst(session.id);
        setStats({
          totalVentas: Number(localStats.totalSales || 0),
          totalEfectivo: Number(localStats.totalCash || 0),
          totalTransferencia: Number(localStats.totalTransfer || 0),
          cantidadVentas: Number(localStats.saleCount || 0),
        });
      } catch (err: any) {
        console.warn(
          "[SessionStats] fetchStats exception:",
          err?.message || JSON.stringify(err)
        );
      }
    };

    void fetchStats();
    const interval = window.setInterval(() => {
      void fetchStats();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [session?.id]);

  const toggleStatsVisibility = () => {
    if (showStats) {
      setShowStats(false);
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else {
      setShowStats(true);
      // Ocultar automáticamente tras 15 segundos
      timeoutRef.current = window.setTimeout(() => {
        setShowStats(false);
      }, 15000);
    }
  };

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!session) {
    return (
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 bg-slate-900 px-4 py-3 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 ring-1 ring-slate-700">
            <Calculator className="h-4 w-4 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Dia Operativo</h2>
            <p className="text-xs text-slate-400">Inicializando jornada automatica...</p>
          </div>
        </div>
      </div>
    );
  }

  const formatMoney = (value: number) => showStats ? `$${value.toFixed(2)}` : "- - -";

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 ring-1 ring-slate-700">
            <Calculator className="h-4 w-4 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Dia Operativo Actual</h2>
          </div>
        </div>
        <Badge variant="secondary" className="bg-slate-700 text-slate-100">
          <TrendingUp className="mr-1 h-3 w-3" />
          {stats.cantidadVentas}
        </Badge>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <span className="text-sm font-medium text-slate-500">Ventas del dia</span>
          <span className="text-[32px] font-bold leading-none tracking-tight text-slate-900 transition-all duration-300">
            {formatMoney(stats.totalVentas)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-2.5 pt-2 text-center">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
              Efectivo
            </span>
            <span className="text-base font-bold text-emerald-700 transition-all duration-300">
              {formatMoney(stats.totalEfectivo)}
            </span>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-2.5 pt-2 text-center">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-sky-600">
              Transfer.
            </span>
            <span className="text-base font-bold text-sky-700 transition-all duration-300">
              {formatMoney(stats.totalTransferencia)}
            </span>
          </div>
        </div>

        <Button
          variant={showStats ? "secondary" : "default"}
          size="sm"
          className="w-full text-xs font-semibold uppercase tracking-wider h-9"
          onClick={toggleStatsVisibility}
        >
          {showStats ? (
            <>
              <EyeOff className="mr-2 h-4 w-4" />
              Ocultar
            </>
          ) : (
            <>
              <Eye className="mr-2 h-4 w-4" />
              Mostrar
            </>
          )}
        </Button>
      </div>
    </div>
  );
}


