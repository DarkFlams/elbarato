"use client";

import { AlertTriangle, CloudOff, CloudUpload, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOfflineSync } from "@/hooks/use-offline-sync";

export function OfflineSyncIndicator() {
  const {
    isOnline,
    isSyncing,
    pendingCount,
    failedCount,
    runSync,
  } = useOfflineSync();

  const shouldRender =
    !isOnline || isSyncing || pendingCount > 0 || failedCount > 0;

  if (!shouldRender) return null;

  return (
    <div
      className={`mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
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
        <span className="font-medium">
          {!isOnline
            ? `Modo offline activo. Pendientes: ${pendingCount}`
            : failedCount > 0
            ? `Hay ${failedCount} operacion(es) con error en cola`
            : isSyncing
            ? `Sincronizando ${pendingCount} pendiente(s)...`
            : `${pendingCount} pendiente(s) por sincronizar`}
        </span>
      </div>

      {isOnline && pendingCount > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void runSync()}
          disabled={isSyncing}
          className="h-7 border-current bg-transparent px-2 text-xs"
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
          Sincronizar
        </Button>
      )}
    </div>
  );
}
