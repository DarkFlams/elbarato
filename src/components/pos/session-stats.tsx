/**
 * @file session-stats.tsx
 * @description Panel lateral izquierdo del POS. Muestra estadisticas en vivo de la sesion
 * actual (ventas, desglose por metodos de pago, KPIs por socia) y permite cerrar caja.
 */

"use client";

import { useState, useEffect } from "react";
import { 
  Calculator, 
  Clock, 
  DollarSign, 
  Banknote, 
  ArrowRightLeft, 
  LogOut,
  TrendingUp,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useCashSession } from "@/hooks/use-cash-session";
import { PARTNERS } from "@/lib/constants";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface LiveStats {
  totalVentas: number;
  totalEfectivo: number;
  totalTransferencia: number;
  cantidadVentas: number;
  socias: Record<string, number>;
}

export function SessionStats() {
  const { session, closeSession, refresh } = useCashSession();
  const [stats, setStats] = useState<LiveStats>({
    totalVentas: 0,
    totalEfectivo: 0,
    totalTransferencia: 0,
    cantidadVentas: 0,
    socias: {},
  });
  const [elapsedTime, setElapsedTime] = useState("");
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingCash, setClosingCash] = useState("");
  const [notes, setNotes] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const router = useRouter();

  // Calcular tiempo transcurrido
  useEffect(() => {
    if (!session) return;

    const interval = setInterval(() => {
      const start = new Date(session.opened_at).getTime();
      const now = new Date().getTime();
      const diff = Math.max(0, now - start);

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setElapsedTime(`${hours}h ${minutes}m`);
    }, 1000 * 60);

    // Initial calc
    const start = new Date(session.opened_at).getTime();
    const now = new Date().getTime();
    const diff = Math.max(0, now - start);
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    setElapsedTime(`${hours}h ${minutes}m`);

    return () => clearInterval(interval);
  }, [session]);

  // Cargar estadísticas en vivo
  useEffect(() => {
    if (!session) return;

    const fetchStats = async () => {
      if (!session?.id) return;

      try {
        const supabase = createClient();
        const { data: sales, error } = await supabase
          .from("sales")
          .select("id, total_amount, payment_method")
          .eq("cash_session_id", session.id);

        if (error) {
          console.warn("[SessionStats] Supabase query error:", error.message || JSON.stringify(error));
          return;
        }

        let totalV = 0, totalE = 0, totalT = 0;

        (sales ?? []).forEach((s: { total_amount: number | string, payment_method: string }) => {
          const amt = Number(s.total_amount) || 0;
          totalV += amt;
          if (s.payment_method === "cash") totalE += amt;
          else if (s.payment_method === "transfer") totalT += amt;
        });

        setStats({
          totalVentas: totalV,
          totalEfectivo: totalE,
          totalTransferencia: totalT,
          cantidadVentas: (sales ?? []).length,
          socias: {},
        });
      } catch (err: any) {
        console.warn("[SessionStats] fetchStats exception:", err?.message || JSON.stringify(err));
      }
    };

    fetchStats();

    // Set up realtime sub
    const supabase = createClient();
    const channel = supabase
      .channel("live-session-stats")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sales", filter: `cash_session_id=eq.${session.id}` },
        () => fetchStats()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session]);

  if (!session) return null;

  const expectedCash = session.opening_cash + stats.totalEfectivo;
  const countedCash = parseFloat(closingCash) || 0;
  const difference = countedCash - expectedCash;

  const handleCloseSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (countedCash < 0) {
      toast.error("El monto ingresado no es válido");
      return;
    }

    setIsClosing(true);
    const success = await closeSession(countedCash, notes);
    setIsClosing(false);

    if (success) {
      toast.success("Caja cerrada exitosamente");
      setShowCloseModal(false);
      // El modal de apertura aparecerá automáticamente porque session pasará a null
    }
  };

  return (
    <>
      <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0">
        {/* Header de la sesion */}
        <div className="bg-slate-900 px-5 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 ring-1 ring-slate-700">
              <Calculator className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Sesion Activa</h2>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {elapsedTime || "0h 0m"}
                </span>
                <span>•</span>
                <span>Base: ${session.opening_cash.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setShowCloseModal(true)}
            className="text-slate-300 hover:text-white hover:bg-slate-800 hidden sm:flex"
          >
            <LogOut className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Cerrar Caja</span>
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setShowCloseModal(true)}
            className="text-slate-300 hover:text-white hover:bg-slate-800 sm:hidden"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>

        {/* Stats compactos */}
        <div className="p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-500">Ventas del Día</span>
              <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-medium">
                <TrendingUp className="h-3 w-3 mr-1" />
                {stats.cantidadVentas}
              </Badge>
            </div>
            <span className="text-2xl font-bold tracking-tight text-slate-900">
              ${stats.totalVentas.toFixed(2)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 pt-2 text-center">
              <span className="text-[11px] font-semibold text-emerald-600 tracking-wider uppercase block mb-1">Efectivo</span>
              <span className="text-lg font-bold text-emerald-700">
                ${stats.totalEfectivo.toFixed(2)}
              </span>
            </div>
            <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3 pt-2 text-center">
              <span className="text-[11px] font-semibold text-sky-600 tracking-wider uppercase block mb-1">Transfer.</span>
              <span className="text-lg font-bold text-sky-700">
                ${stats.totalTransferencia.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Cierre */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-[24px] bg-white p-6 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                  <LogOut className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Cerrar Caja</h3>
                  <p className="text-xs text-slate-500">Sesion actual: {elapsedTime}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowCloseModal(false)}>Cancelar</Button>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 mb-6 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Apertura (Base)</span>
                <span className="font-medium">${session.opening_cash.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Ventas en Efectivo</span>
                <span className="font-medium text-emerald-600">+${stats.totalEfectivo.toFixed(2)}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between">
                <span className="font-semibold text-slate-900">Esperado en Caja</span>
                <span className="font-bold text-slate-900">${expectedCash.toFixed(2)}</span>
              </div>
            </div>

            <form onSubmit={handleCloseSession} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="closingCash">Efectivo real contado (Billetes/Monedas)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <Input
                    id="closingCash"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                    className="pl-10 h-12 text-lg font-mono border-slate-200"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
                {closingCash !== "" && (
                  <p className={`text-xs font-medium mt-1 ${difference === 0 ? "text-emerald-600" : difference > 0 ? "text-amber-600" : "text-red-600"}`}>
                    Diferencia: {difference > 0 ? "+" : ""}{difference.toFixed(2)}
                    {difference === 0 ? " (Cuadre perfecto)" : difference > 0 ? " (Sobrante)" : " (Faltante)"}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notas (Opcional)</Label>
                <Input
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Justificacion de faltantes/sobrantes..."
                  className="bg-slate-50"
                />
              </div>

              <Button
                type="submit"
                disabled={isClosing}
                className="w-full h-12 mt-4 bg-slate-900 hover:bg-slate-800 text-white"
              >
                {isClosing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Confirmar Cierre"}
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
