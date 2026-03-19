/**
 * @file session-stats.tsx
 * @description Panel lateral del POS con estadisticas de operacion.
 */

"use client";

import { useEffect, useState } from "react";
import { Calculator, Clock, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  const [elapsedTime, setElapsedTime] = useState("");

  useEffect(() => {
    if (!session) return;

    const calculateElapsed = () => {
      const start = new Date(session.opened_at).getTime();
      const now = new Date().getTime();
      const diff = Math.max(0, now - start);
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setElapsedTime(`${hours}h ${minutes}m`);
    };

    calculateElapsed();
    const interval = window.setInterval(calculateElapsed, 60_000);
    return () => window.clearInterval(interval);
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

  if (!session) {
    return (
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 bg-slate-900 px-5 py-4 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 ring-1 ring-slate-700">
            <Calculator className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Caja Local</h2>
            <p className="text-xs text-slate-400">Inicializando sesion automatica...</p>
          </div>
        </div>
      </div>
    );
  }

  const expectedCash = session.opening_cash + stats.totalEfectivo;

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-slate-900 px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 ring-1 ring-slate-700">
            <Calculator className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Caja Local Activa</h2>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {elapsedTime || "0h 0m"}
              </span>
              <span>|</span>
              <span>Base: ${session.opening_cash.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <Badge variant="secondary" className="bg-slate-700 text-slate-100">
          <TrendingUp className="mr-1 h-3 w-3" />
          {stats.cantidadVentas}
        </Badge>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <span className="text-sm font-medium text-slate-500">Ventas del Dia</span>
          <span className="text-2xl font-bold tracking-tight text-slate-900">
            ${stats.totalVentas.toFixed(2)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 pt-2 text-center">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
              Efectivo
            </span>
            <span className="text-lg font-bold text-emerald-700">
              ${stats.totalEfectivo.toFixed(2)}
            </span>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3 pt-2 text-center">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-sky-600">
              Transfer.
            </span>
            <span className="text-lg font-bold text-sky-700">
              ${stats.totalTransferencia.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Efectivo esperado en caja</span>
            <span className="font-mono font-semibold text-slate-900">
              ${expectedCash.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
