"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CloudOff, CloudUpload, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOfflineSync } from "@/hooks/use-offline-sync";

export function OfflineSyncIndicator() {
  const [isMounted, setIsMounted] = useState(false);
  const {
    isOnline,
    isSyncing,
    syncSupported,
    pendingCount,
    failedCount,
    runSync,
  } = useOfflineSync();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const shouldRender =
    !isOnline || isSyncing || pendingCount > 0 || failedCount > 0;

  if (!isMounted || !shouldRender) return null;

  return (
    <div
      className={`mb-2.5 flex items-center justify-between gap-2.5 rounded-lg border px-3 py-1.5 text-[13px] ${
        !isOnline
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : failedCount > 0
          ? "border-rose-300 bg-rose-50 text-rose-900"
          : "border-sky-300 bg-sky-50 text-sky-900"
      }`}
    >
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <CloudOff className="h-4 w-4" />
        ) : failedCount > 0 ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <CloudUpload className="h-4 w-4" />
        )}
        <span className="font-medium leading-none">
          {!isOnline
            ? `Modo offline activo. Pendientes: ${pendingCount}`
            : failedCount > 0
            ? `Hay ${failedCount} operacion(es) con error en cola`
            : isSyncing
            ? `Sincronizando ${pendingCount} pendiente(s)...`
            : `${pendingCount} pendiente(s) por sincronizar`}
        </span>
      </div>

      {isOnline && pendingCount > 0 && syncSupported && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void runSync()}
          disabled={isSyncing}
          className="h-[26px] border-current bg-transparent px-2 text-[11px]"
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
          Sincronizar
        </Button>
      )}
    </div>
  );
}
