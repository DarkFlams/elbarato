"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Database, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureInitialLocalCatalog, getLocalCatalogBootstrapState } from "@/lib/local/bootstrap";
import { isTauriRuntime } from "@/lib/tauri-runtime";

interface LocalCatalogGateProps {
  children: React.ReactNode;
}

type GateStatus = "checking" | "syncing" | "blocked" | "ready" | "error";

function getBootstrapErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Error desconocido";
  }
}

export function LocalCatalogGate({ children }: LocalCatalogGateProps) {
  const [status, setStatus] = useState<GateStatus>("checking");
  const [message, setMessage] = useState("Verificando base local...");
  const [detail, setDetail] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);

  const bootstrap = useCallback(async () => {
    if (!isTauriRuntime()) {
      setStatus("ready");
      return;
    }

    setStatus("checking");
    setMessage("Verificando base local...");
    setDetail(null);
    setProgress(null);

    try {
      const state = await getLocalCatalogBootstrapState();
      if (state.ready) {
        setStatus("ready");

        if (state.needsRefresh && (typeof navigator === "undefined" || navigator.onLine)) {
          void ensureInitialLocalCatalog().catch((error) => {
            console.warn(
              "[local-catalog-gate] background catalog refresh failed:",
              getBootstrapErrorMessage(error)
            );
          });
        }

        return;
      }

      setStatus("syncing");
      setMessage(
        state.seeded
          ? "Actualizando catalogo local con precios y datos nuevos..."
          : "Descargando catalogo inicial a esta PC..."
      );

      const result = await ensureInitialLocalCatalog((next) => {
        setProgress({ processed: next.processed, total: next.total });
        setMessage(
          next.stage === "partners"
            ? "Descargando socias a la base local..."
            : "Descargando inventario completo y lista de precios a la base local..."
        );
      });

      if (result.ready) {
        setStatus("ready");
        return;
      }

      if (result.requiresInternet) {
        setStatus("blocked");
        setMessage("Esta PC necesita actualizar el catalogo local.");
        setDetail("Conectate a internet una vez para descargar socias, productos, stock y precios tier a la base local.");
        return;
      }

      setStatus("error");
      setMessage("No se pudo preparar la base local.");
      setDetail("La app no deberia operar hasta que el catalogo local quede completo.");
    } catch (error) {
      setStatus("error");
      setMessage("Fallo la preparacion inicial del catalogo local.");
      setDetail(getBootstrapErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void bootstrap();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [bootstrap]);

  if (status === "ready") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100">
            {status === "syncing" || status === "checking" ? (
              <Loader2 className="h-5 w-5 animate-spin text-slate-700" />
            ) : status === "blocked" ? (
              <WifiOff className="h-5 w-5 text-amber-700" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-700" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-slate-500" />
              <h2 className="text-base font-semibold text-slate-900">
                Base Local del Desktop
              </h2>
            </div>

            <p className="mt-2 text-sm font-medium text-slate-800">{message}</p>
            {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}

            {progress && progress.total > 0 ? (
              <div className="mt-4 space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-900 transition-all"
                    style={{
                      width: `${Math.min(100, (progress.processed / progress.total) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  {progress.processed} / {progress.total}
                </p>
              </div>
            ) : null}

            <div className="mt-5 flex justify-end">
              <Button
                onClick={() => void bootstrap()}
                variant={status === "error" || status === "blocked" ? "default" : "outline"}
                className={
                  status === "error" || status === "blocked"
                    ? "bg-slate-900 text-white hover:bg-slate-800"
                    : ""
                }
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Reintentar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
