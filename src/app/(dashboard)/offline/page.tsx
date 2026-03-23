"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
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
import { getLocalCatalogBootstrapState } from "@/lib/local/bootstrap";
import {
  getSyncQueueStatsLocalFirst,
  listSyncQueuePreviewLocalFirst,
  removeSyncQueueItemLocalFirst,
  requeueAllFailedSyncQueueItemsLocalFirst,
  requeueSyncQueueItemLocalFirst,
  type LocalSyncQueueItem,
  type SyncQueueStatusFilter,
} from "@/lib/local/sync-queue";
import { formatSyncErrorMessage } from "@/lib/local/sync-errors";
import { useOfflineSync } from "@/hooks/use-offline-sync";
import { formatEcuadorDateTime } from "@/lib/timezone-ecuador";

const OFFLINE_PREVIEW_STEP = 200;
const OFFLINE_REFRESH_MS = 5000;

function formatOperationType(operation: LocalSyncQueueItem) {
  if (operation.entityName === "sales") return "Venta";
  if (operation.entityName === "expenses") return "Gasto";
  if (operation.entityName === "products" && operation.operationType === "create_remate") return "Remate";
  if (operation.entityName === "products" && operation.operationType === "dispose") return "Desecho";
  if (operation.entityName === "products") return "Producto";
  if (operation.entityName === "inventory_movements") return "Inventario";
  if (operation.entityName === "cash_sessions" && operation.operationType === "close") return "Cierre legado";
  if (operation.entityName === "cash_sessions") return "Dia operativo";
  return `${operation.entityName}:${operation.operationType}`;
}

function formatOperationSummary(operation: LocalSyncQueueItem) {
  try {
    const payload = JSON.parse(operation.payloadJson) as Record<string, unknown>;

    if (operation.entityName === "sales") {
      const items = Array.isArray(payload.items) ? payload.items : [];
      const total = items.reduce((sum, item) => {
        const row = item as { quantity?: number; unitPrice?: number };
        return sum + Number(row.quantity ?? 0) * Number(row.unitPrice ?? 0);
      }, 0);
      const paymentMethod =
        payload.paymentMethod === "cash" ? "Efectivo" : "Transferencia";
      return `${paymentMethod} - ${items.length} item(s) - $${total.toFixed(2)}`;
    }

    if (operation.entityName === "expenses") {
      return `${String(payload.description ?? "Sin descripcion")} - $${Number(
        payload.amount ?? 0
      ).toFixed(2)}`;
    }

    if (operation.entityName === "products" && operation.operationType === "create_remate") {
      return `Remate - $${Number(payload.clearancePrice ?? 0).toFixed(2)} - ${Number(
        payload.stock ?? 0
      )} unidad(es)`;
    }

    if (operation.entityName === "products") {
      return `${String(payload.name ?? "Producto")} - barcode ${String(
        payload.barcode ?? "-"
      )}`;
    }

    if (operation.entityName === "inventory_movements") {
      return `${String(payload.operation ?? "adjust")} - ${Number(
        payload.quantity ?? 0
      )} unidad(es)`;
    }

    if (operation.entityName === "cash_sessions" && operation.operationType === "close") {
      return `Cierre legado - efectivo final $${Number(payload.closingCash ?? 0).toFixed(2)}`;
    }

    if (operation.entityName === "cash_sessions") {
      return `Inicio automatico del dia - base $${Number(payload.openingCash ?? 0).toFixed(2)}`;
    }
  } catch {
    // fallback below
  }

  return `${operation.entityName} - ${operation.operationType}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return formatEcuadorDateTime(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function OfflinePage() {
  const [operations, setOperations] = useState<LocalSyncQueueItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<SyncQueueStatusFilter>("all");
  const [visibleCount, setVisibleCount] = useState(OFFLINE_PREVIEW_STEP);
  const [catalogState, setCatalogState] = useState<{
    ready: boolean;
    seeded: boolean;
    requiresInternet: boolean;
    productCount: number;
  } | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [isSyncingManual, setIsSyncingManual] = useState(false);
  const { isOnline, isSyncing, runSync, syncSupported, pendingCount, failedCount, totalCount } =
    useOfflineSync();

  const refreshOperations = useCallback(async () => {
    const items = await listSyncQueuePreviewLocalFirst({
      limit: visibleCount,
      status: statusFilter,
    });
    setOperations(items);
    return items;
  }, [statusFilter, visibleCount]);

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      const nextCatalogState = await getLocalCatalogBootstrapState();
      if (!isCancelled) setCatalogState(nextCatalogState);
    };

    void load();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      const items = await listSyncQueuePreviewLocalFirst({
        limit: visibleCount,
        status: statusFilter,
      });

      if (!isCancelled) {
        setOperations(items);
      }
    };

    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, OFFLINE_REFRESH_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(timer);
    };
  }, [statusFilter, visibleCount]);

  const handleSyncNow = async () => {
    if (!isOnline) {
      toast.error("No hay internet. No se puede sincronizar ahora.");
      return;
    }

    setIsSyncingManual(true);
    const before = totalCount;
    await runSync();
    const afterStats = await getSyncQueueStatsLocalFirst();
    await refreshOperations();
    setIsSyncingManual(false);

    const syncedCount = Math.max(0, before - afterStats.total);
    if (syncedCount > 0) {
      toast.success(`Sincronizacion completada. ${syncedCount} operacion(es).`);
    } else if (afterStats.failed > 0) {
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
    const updated = await requeueSyncQueueItemLocalFirst(operationId);
    if (!updated) {
      setActioningId(null);
      toast.error("No se encontro la operacion.");
      return;
    }

    await runSync();
    const refreshed = await refreshOperations();
    const stillExists = refreshed.find((op) => op.id === operationId);
    setActioningId(null);

    if (!stillExists) {
      toast.success("Operacion sincronizada correctamente.");
      return;
    }

    if (stillExists.status === "failed") {
      toast.error("La operacion sigue fallando.", {
        description: formatSyncErrorMessage(stillExists.lastError),
      });
      return;
    }

    toast.warning("La operacion sigue pendiente.");
  };

  const handleRetryFailed = async () => {
    const count = await requeueAllFailedSyncQueueItemsLocalFirst();
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

  const handleRemove = async (operationId: string) => {
    await removeSyncQueueItemLocalFirst(operationId);
    await refreshOperations();
    toast.success("Operacion eliminada de la cola local.");
  };

  const hasOperations = operations.length > 0;
  const filteredTotal =
    statusFilter === "pending"
      ? pendingCount
      : statusFilter === "failed"
      ? failedCount
      : totalCount;
  const hasMoreOperations = operations.length < filteredTotal;

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
            disabled={failedCount === 0 || !syncSupported}
            className="h-9"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reintentar Fallidos
          </Button>

          <Button
            onClick={() => void handleSyncNow()}
            disabled={!syncSupported || !isOnline || totalCount === 0 || isSyncing || isSyncingManual}
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Catalogo Local
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {catalogState?.productCount ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {catalogState?.ready
              ? "Base local lista"
              : catalogState?.seeded
              ? "Sembrado parcial"
              : "Pendiente de descarga"}
          </p>
        </div>

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

      {catalogState && (
        <div
          className={
            catalogState.ready
              ? "rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
              : "rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">
                {catalogState.ready
                  ? "La base local del inventario ya esta lista en esta PC."
                  : "La base local todavia no esta completa."}
              </p>
              <p className="mt-1 text-xs opacity-90">
                Productos guardados localmente: {catalogState.productCount}
              </p>
            </div>

            <Badge
              variant="outline"
              className={
                catalogState.ready
                  ? "border-emerald-300 bg-white text-emerald-700"
                  : "border-amber-300 bg-white text-amber-700"
              }
            >
              {catalogState.ready ? "Listo para offline" : "Falta bootstrap"}
            </Badge>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Detalle de Operaciones</h2>
            <Button
              type="button"
              size="sm"
              variant={statusFilter === "all" ? "default" : "outline"}
              className="h-8"
              onClick={() => {
                setStatusFilter("all");
                setVisibleCount(OFFLINE_PREVIEW_STEP);
              }}
            >
              Todos
            </Button>
            <Button
              type="button"
              size="sm"
              variant={statusFilter === "failed" ? "default" : "outline"}
              className="h-8"
              onClick={() => {
                setStatusFilter("failed");
                setVisibleCount(OFFLINE_PREVIEW_STEP);
              }}
            >
              Fallidos
            </Button>
            <Button
              type="button"
              size="sm"
              variant={statusFilter === "pending" ? "default" : "outline"}
              className="h-8"
              onClick={() => {
                setStatusFilter("pending");
                setVisibleCount(OFFLINE_PREVIEW_STEP);
              }}
            >
              Pendientes
            </Button>
          </div>
          <span className="text-xs text-slate-500">
            Mostrando {operations.length} de {filteredTotal}
          </span>
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
          <>
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
                          className="border-sky-200 bg-sky-50 text-sky-700"
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
                        creado: {formatDateTime(operation.createdAt)}
                      </p>
                      {operation.updatedAt && operation.updatedAt !== operation.createdAt && (
                        <p className="text-xs text-slate-500">
                          ultima actualizacion: {formatDateTime(operation.updatedAt)}
                        </p>
                      )}
                      {operation.lastError && (
                        <p className="mt-1 flex items-start gap-1 text-xs text-rose-600">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="break-words">
                            {formatSyncErrorMessage(operation.lastError)}
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleRetryOne(operation.id)}
                        disabled={
                          !syncSupported ||
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
                        onClick={() => void handleRemove(operation.id)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Quitar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">
                La vista carga una muestra paginada para no congelar la app con miles de registros.
              </p>
              {hasMoreOperations ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleCount((current) => current + OFFLINE_PREVIEW_STEP)}
                >
                  <ChevronDown className="mr-1 h-3.5 w-3.5" />
                  Cargar mas
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

