"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CloudOff,
  CloudUpload,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getOfflineQueue,
  getOfflineQueueStats,
  removeOfflineOperation,
  requeueAllFailedOfflineOperations,
  requeueOfflineOperation,
  subscribeOfflineQueue,
} from "@/lib/offline/queue";
import type { OfflineOperation } from "@/lib/offline/types";
import { useOfflineSync } from "@/hooks/use-offline-sync";

function readSortedOperations() {
  return getOfflineQueue().sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function formatOperationType(operation: OfflineOperation) {
  return operation.type === "register_sale" ? "Venta" : "Gasto";
}

function formatOperationSummary(operation: OfflineOperation) {
  if (operation.type === "register_sale") {
    const total = operation.payload.p_items.reduce(
      (sum, item) => sum + item.quantity * item.unit_price,
      0
    );
    const paymentLabel =
      operation.payload.p_payment_method === "cash"
        ? "Efectivo"
        : "Transferencia";
    return `${paymentLabel} - ${operation.payload.p_items.length} item(s) - $${total.toFixed(
      2
    )}`;
  }

  const amount = Number(operation.payload.p_amount ?? 0);
  const scope =
    operation.payload.p_scope === "shared" ? "Compartido" : "Individual";
  const description = operation.payload.p_description ?? "Sin descripcion";

  return `${description} - $${amount.toFixed(2)} - ${scope}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-EC", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function OfflinePage() {
  const [operations, setOperations] = useState<OfflineOperation[]>(
    readSortedOperations
  );
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [isSyncingManual, setIsSyncingManual] = useState(false);
  const { isOnline, isSyncing, runSync, pendingCount, failedCount, totalCount } =
    useOfflineSync();

  useEffect(() => {
    const unsubscribe = subscribeOfflineQueue(() => {
      setOperations(readSortedOperations());
    });
    return unsubscribe;
  }, []);

  const handleSyncNow = async () => {
    if (!isOnline) {
      toast.error("No hay internet. No se puede sincronizar ahora.");
      return;
    }

    setIsSyncingManual(true);
    const before = getOfflineQueueStats();
    await runSync();
    const after = getOfflineQueueStats();
    setIsSyncingManual(false);

    const syncedCount = Math.max(0, before.total - after.total);
    if (syncedCount > 0) {
      toast.success(`Sincronizacion completada. ${syncedCount} operacion(es).`);
    } else if (after.failed > 0) {
      toast.warning("Sincronizacion terminada con errores en cola.");
    } else {
      toast.message("No habia operaciones para sincronizar.");
    }
  };

  const handleRetryOne = async (operationId: string) => {
    if (!isOnline) {
      toast.error("No hay internet. Reconecta para reintentar.");
      return;
    }

    setActioningId(operationId);
    const updated = requeueOfflineOperation(operationId);
    if (!updated) {
      setActioningId(null);
      toast.error("No se encontro la operacion.");
      return;
    }

    await runSync();
    const stillExists = getOfflineQueue().find((op) => op.id === operationId);
    setActioningId(null);

    if (!stillExists) {
      toast.success("Operacion sincronizada correctamente.");
      return;
    }

    if (stillExists.status === "failed") {
      toast.error("La operacion sigue fallando.", {
        description: stillExists.last_error ?? "Error desconocido",
      });
      return;
    }

    toast.warning("La operacion sigue pendiente.");
  };

  const handleRetryFailed = async () => {
    const count = requeueAllFailedOfflineOperations();
    if (count === 0) {
      toast.message("No hay operaciones fallidas para reintentar.");
      return;
    }

    if (!isOnline) {
      toast.warning(
        `${count} operacion(es) marcadas para retry. Se sincronizaran al volver internet.`
      );
      return;
    }

    await handleSyncNow();
  };

  const handleRemove = (operationId: string) => {
    removeOfflineOperation(operationId);
    toast.success("Operacion eliminada de la cola local.");
  };

  const hasOperations = operations.length > 0;

  const headerStatus = useMemo(() => {
    if (!isOnline) return "Offline";
    if (isSyncing || isSyncingManual) return "Sincronizando";
    return "Online";
  }, [isOnline, isSyncing, isSyncingManual]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <CloudOff className="h-5 w-5 text-slate-700" />
            Operaciones Offline
          </h1>
          <p className="text-sm text-slate-500">
            Control manual de pendientes y errores de sincronizacion.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={
              isOnline
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }
          >
            {isOnline ? (
              <>
                <CloudUpload className="mr-1 h-3.5 w-3.5" />
                {headerStatus}
              </>
            ) : (
              <>
                <CloudOff className="mr-1 h-3.5 w-3.5" />
                {headerStatus}
              </>
            )}
          </Badge>

          <Button
            variant="outline"
            onClick={() => void handleRetryFailed()}
            disabled={failedCount === 0}
            className="h-9"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reintentar Fallidos
          </Button>

          <Button
            onClick={() => void handleSyncNow()}
            disabled={!isOnline || totalCount === 0 || isSyncing || isSyncingManual}
            className="h-9 bg-slate-900 text-white hover:bg-slate-800"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${
                isSyncing || isSyncingManual ? "animate-spin" : ""
              }`}
            />
            Sincronizar Ahora
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Pendientes
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{pendingCount}</p>
        </div>

        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-rose-600">
            Fallidos
          </p>
          <p className="mt-2 text-2xl font-bold text-rose-700">{failedCount}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Total en Cola
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalCount}</p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Detalle de Operaciones
          </h2>
          <span className="text-xs text-slate-500">{operations.length} registro(s)</span>
        </div>

        {!hasOperations ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
            <CloudUpload className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">
              No hay operaciones en cola
            </p>
            <p className="text-xs text-slate-400">
              Todo lo offline ya fue sincronizado.
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div className="divide-y divide-slate-100">
              {operations.map((operation) => (
                <div
                  key={operation.id}
                  className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          operation.type === "register_sale"
                            ? "border-sky-200 bg-sky-50 text-sky-700"
                            : "border-violet-200 bg-violet-50 text-violet-700"
                        }
                      >
                        {formatOperationType(operation)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          operation.status === "pending"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-rose-200 bg-rose-50 text-rose-700"
                        }
                      >
                        {operation.status === "pending" ? "Pendiente" : "Fallido"}
                      </Badge>
                      <span className="text-xs text-slate-400">
                        intento(s): {operation.attempts}
                      </span>
                    </div>

                    <p className="truncate text-sm font-medium text-slate-700">
                      {formatOperationSummary(operation)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      creado: {formatDateTime(operation.created_at)}
                    </p>
                    {operation.last_attempt_at && (
                      <p className="text-xs text-slate-500">
                        ultimo intento: {formatDateTime(operation.last_attempt_at)}
                      </p>
                    )}
                    {operation.last_error && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-rose-600">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="break-words">{operation.last_error}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRetryOne(operation.id)}
                      disabled={
                        !isOnline ||
                        actioningId === operation.id ||
                        (isSyncing || isSyncingManual)
                      }
                    >
                      {actioningId === operation.id ? (
                        <>
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          Retry
                        </>
                      ) : (
                        <>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          Retry
                        </>
                      )}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      className="border-rose-200 text-rose-700 hover:bg-rose-50"
                      onClick={() => handleRemove(operation.id)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Quitar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
