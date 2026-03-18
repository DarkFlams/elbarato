/**
 * @file use-cash-session.ts
 * @description Hook para gestionar la sesión de caja activa.
 *
 * Una "sesión de caja" es el período entre la apertura y el cierre.
 * Todas las ventas y gastos se registran bajo la sesión activa.
 *
 * FLUJO:
 * 1. Al cargar el POS, buscar si hay sesión abierta en Supabase.
 * 2. Si no hay → abrir nueva sesión automáticamente.
 * 3. Al cerrar caja → marcar sesión como 'closed' con timestamp.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CashSession } from "@/types/database";

interface UseCashSessionReturn {
  /** Sesión activa actual, null si no hay */
  session: CashSession | null;
  /** Estado de carga */
  isLoading: boolean;
  /** Error si ocurre */
  error: string | null;
  /** Abrir nueva sesión de caja */
  openSession: (openingCash?: number) => Promise<CashSession | null>;
  /** Cerrar la sesión activa */
  closeSession: (closingCash?: number, notes?: string) => Promise<boolean>;
  /** Recargar datos de sesión */
  refresh: () => Promise<void>;
}

export function useCashSession(): UseCashSessionReturn {
  const [session, setSession] = useState<CashSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  /** Buscar sesión abierta existente */
  const fetchOpenSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from("cash_sessions")
        .select("*")
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) throw fetchError;
      setSession(data as CashSession | null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error cargando sesión de caja";
      setError(message);
      console.error("[useCashSession] fetchOpenSession error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  /** Abrir nueva sesión */
  const openSession = useCallback(
    async (openingCash: number = 0): Promise<CashSession | null> => {
      setError(null);

      try {
        // Verificar que no haya sesión abierta
        const { data: existing } = await supabase
          .from("cash_sessions")
          .select("id")
          .eq("status", "open")
          .limit(1)
          .maybeSingle();

        if (existing) {
          setError("Ya existe una sesión de caja abierta");
          return null;
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        const { data, error: insertError } = await supabase
          .from("cash_sessions")
          .insert({
            opened_by: user?.id ?? null,
            opening_cash: openingCash,
            status: "open",
          })
          .select()
          .single();

        if (insertError) throw insertError;

        const newSession = data as CashSession;
        setSession(newSession);
        return newSession;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Error abriendo sesión de caja";
        setError(message);
        console.error("[useCashSession] openSession error:", err);
        return null;
      }
    },
    [supabase]
  );

  /** Cerrar sesión activa */
  const closeSession = useCallback(
    async (closingCash?: number, notes?: string): Promise<boolean> => {
      if (!session) {
        setError("No hay sesión activa para cerrar");
        return false;
      }

      setError(null);

      try {
        const { error: updateError } = await supabase
          .from("cash_sessions")
          .update({
            status: "closed",
            closed_at: new Date().toISOString(),
            closing_cash: closingCash ?? null,
            notes: notes ?? null,
          })
          .eq("id", session.id);

        if (updateError) throw updateError;

        setSession(null);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Error cerrando sesión de caja";
        setError(message);
        console.error("[useCashSession] closeSession error:", err);
        return false;
      }
    },
    [session, supabase]
  );

  // Cargar sesión al montar
  useEffect(() => {
    fetchOpenSession();
  }, [fetchOpenSession]);

  return {
    session,
    isLoading,
    error,
    openSession,
    closeSession,
    refresh: fetchOpenSession,
  };
}
