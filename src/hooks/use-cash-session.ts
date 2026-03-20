/**
 * @file use-cash-session.ts
 * @description Hook local-first para el dia operativo automatico.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getOpenCashSessionLocalFirst,
  openCashSessionLocalFirst,
} from "@/lib/local/cash-expenses";
import { ecuadorDayKey } from "@/lib/timezone-ecuador";
import type { CashSession } from "@/types/database";

interface UseCashSessionReturn {
  session: CashSession | null;
  isLoading: boolean;
  error: string | null;
  openSession: (openingCash?: number) => Promise<CashSession | null>;
  closeSession: (closingCash?: number, notes?: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useCashSession(): UseCashSessionReturn {
  const [session, setSession] = useState<CashSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOpenSession = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      let data = await getOpenCashSessionLocalFirst();

      // Modelo sin apertura/cierre manual: siempre debe existir un dia operativo activo para hoy.
      if (!data) {
        data = await openCashSessionLocalFirst(0);
      }

      setSession(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error cargando el dia operativo";
      setError(message);
      console.error("[useCashSession] fetchOpenSession error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const openSession = useCallback(async (openingCash = 0): Promise<CashSession | null> => {
    setError(null);

    try {
      if (session) return session;

      const newSession = await openCashSessionLocalFirst(openingCash);
      setSession(newSession);
      return newSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error preparando el dia operativo";
      setError(message);
      console.error("[useCashSession] openSession error:", err);
      return null;
    }
  }, [session]);

  const closeSession = useCallback(async (closingCash?: number, notes?: string) => {
    void closingCash;
    void notes;
    setError(null);

    try {
      // Se mantiene por compatibilidad, pero queda deshabilitado.
      setError("El cierre manual ya no existe en este sistema");
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error cerrando operacion manual";
      setError(message);
      console.error("[useCashSession] closeSession error:", err);
      return false;
    }
  }, []);

  useEffect(() => {
    void fetchOpenSession();
  }, [fetchOpenSession]);

  useEffect(() => {
    const verifyCurrentDay = () => {
      if (!session?.opened_at) return;

      const sessionDay = ecuadorDayKey(session.opened_at);
      const todayDay = ecuadorDayKey();

      if (sessionDay !== todayDay) {
        void fetchOpenSession();
      }
    };

    const interval = window.setInterval(verifyCurrentDay, 60_000);
    window.addEventListener("focus", verifyCurrentDay);
    document.addEventListener("visibilitychange", verifyCurrentDay);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", verifyCurrentDay);
      document.removeEventListener("visibilitychange", verifyCurrentDay);
    };
  }, [fetchOpenSession, session?.opened_at]);

  return {
    session,
    isLoading,
    error,
    openSession,
    closeSession,
    refresh: fetchOpenSession,
  };
}

