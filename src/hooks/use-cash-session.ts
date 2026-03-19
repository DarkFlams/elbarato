/**
 * @file use-cash-session.ts
 * @description Hook local-first para sesion activa de caja.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getOpenCashSessionLocalFirst,
  openCashSessionLocalFirst,
} from "@/lib/local/cash-expenses";
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

      // Modelo sin apertura/cierre manual: siempre debe existir una sesion activa.
      if (!data) {
        data = await openCashSessionLocalFirst(0);
      }

      setSession(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error cargando sesion de caja";
      setError(message);
      console.error("[useCashSession] fetchOpenSession error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const openSession = useCallback(async (openingCash = 0): Promise<CashSession | null> => {
    setError(null);

    try {
      if (session) {
        setError("Ya existe una sesion de caja abierta");
        return session;
      }

      const newSession = await openCashSessionLocalFirst(openingCash);
      setSession(newSession);
      return newSession;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error abriendo sesion de caja";
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
      setError("La funcion de cierre manual de caja esta deshabilitada");
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error cerrando sesion de caja";
      setError(message);
      console.error("[useCashSession] closeSession error:", err);
      return false;
    }
  }, []);

  useEffect(() => {
    void fetchOpenSession();
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
