"use client";

import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { isConnectivityError } from "@/lib/offline/queue";
import {
  listSyncQueueLocalFirst,
  markSyncQueueItemFailedLocalFirst,
  markSyncQueueItemSyncedLocalFirst,
  type LocalSyncQueueItem,
} from "@/lib/local/sync-queue";

interface LocalPartnerKey {
  id: string;
  remote_id?: string | null;
}

interface LocalCashSessionKey {
  id: string;
  remote_id?: string | null;
}

interface LocalProductKey {
  id: string;
  remote_id?: string | null;
  barcode: string;
}

interface RegisterLocalSalePayload {
  cashSessionId: string;
  paymentMethod: "cash" | "transfer";
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
  }>;
  notes?: string | null;
  amountReceived?: number | null;
  changeGiven?: number | null;
  idempotencyKey?: string | null;
}

interface UpsertLocalExpensePayload {
  expenseId?: string | null;
  cashSessionId: string;
  amount: number;
  description: string;
  scope: "individual" | "shared";
  partnerId?: string | null;
  sharedPartnerIds?: string[] | null;
  idempotencyKey?: string | null;
}

interface UpsertLocalProductPayload {
  productId?: string | null;
  remoteId?: string | null;
  barcode: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  ownerId: string;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  isActive: boolean;
}

interface AdjustInventoryPayload {
  productId: string;
  quantity: number;
  operation: "in" | "out";
  reason: string;
}

interface CreateRematePayload {
  productId: string;
  clearancePrice: number;
  stock: number;
}

interface DisposeProductPayload {
  productId: string;
}

interface OpenCashSessionPayload {
  openingCash?: number;
}

interface CloseCashSessionPayload {
  closingCash?: number | null;
  notes?: string | null;
}

export interface DesktopSyncResult {
  processed: number;
  synced: number;
  failed: number;
  stopped_by_connectivity: boolean;
}

type RemoteIdMap = Map<string, string | null>;

interface SyncReferenceState {
  partnerRemoteIds: RemoteIdMap;
  productRemoteIds: RemoteIdMap;
  cashSessionRemoteIds: RemoteIdMap;
  expenseRemoteIds: RemoteIdMap;
}

class RetryableSyncError extends Error {}

let currentDesktopSyncPromise: Promise<DesktopSyncResult> | null = null;

function getSyncPriority(item: LocalSyncQueueItem) {
  if (item.entityName === "cash_sessions") return 0;
  if (item.entityName === "products") return 1;
  if (item.entityName === "inventory_movements") return 2;
  if (item.entityName === "expenses") return 3;
  if (item.entityName === "sales") return 4;
  return 5;
}

function getRpcRow<T = Record<string, unknown>>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }

  return (data as T | null) ?? null;
}

function normalizeErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Error de sincronizacion desconocido";
}

function parsePayload<T>(item: LocalSyncQueueItem): T {
  try {
    return JSON.parse(item.payloadJson) as T;
  } catch {
    throw new Error(`Payload invalido para ${item.entityName}/${item.operationType}`);
  }
}

function rememberRemoteId(map: RemoteIdMap, localId: string | null | undefined, remoteId: string | null) {
  if (localId) {
    map.set(localId, remoteId ?? null);
  }

  if (remoteId) {
    map.set(remoteId, remoteId);
  }
}

function buildRemoteIdMap<T extends { id: string; remote_id?: string | null }>(rows: T[]) {
  const map: RemoteIdMap = new Map();
  for (const row of rows) {
    rememberRemoteId(map, row.id, row.remote_id ?? null);
  }
  return map;
}

function resolveRemoteId(
  map: RemoteIdMap,
  rawId: string | null | undefined,
  label: string
) {
  if (!rawId) return null;

  if (map.has(rawId)) {
    const remoteId = map.get(rawId) ?? null;
    if (!remoteId) {
      throw new RetryableSyncError(`${label} local aun no tiene remote_id`);
    }
    return remoteId;
  }

  return rawId;
}

function resolveRequiredRemoteId(
  map: RemoteIdMap,
  rawId: string | null | undefined,
  label: string
) {
  const remoteId = resolveRemoteId(map, rawId, label);
  if (!remoteId) {
    throw new RetryableSyncError(`${label} local aun no tiene remote_id`);
  }
  return remoteId;
}

function isItemDue(item: LocalSyncQueueItem) {
  if (!item.nextRetryAt) return true;
  const nextRetryAt = Date.parse(item.nextRetryAt);
  if (Number.isNaN(nextRetryAt)) return true;
  return nextRetryAt <= Date.now();
}

async function loadReferenceState(): Promise<SyncReferenceState> {
  const [partners, productKeys, cashSessions] = await Promise.all([
    invoke<LocalPartnerKey[]>("list_local_partners"),
    invoke<LocalProductKey[]>("list_local_product_keys"),
    invoke<LocalCashSessionKey[]>("list_local_cash_sessions", {
      fromDate: null,
      toDate: null,
      limit: 5000,
    }),
  ]);

  return {
    partnerRemoteIds: buildRemoteIdMap(partners),
    productRemoteIds: buildRemoteIdMap(productKeys),
    cashSessionRemoteIds: buildRemoteIdMap(cashSessions),
    expenseRemoteIds: new Map<string, string | null>(),
  };
}

async function syncCashSessionItem(
  item: LocalSyncQueueItem,
  state: SyncReferenceState
) {
  const supabase = createClient();

  if (item.operationType === "insert") {
    const payload = parsePayload<OpenCashSessionPayload>(item);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({
        opened_by: user?.id ?? null,
        opening_cash: Number(payload.openingCash ?? 0),
        status: "open",
      })
      .select("id")
      .single();

    if (error) throw error;

    const remoteId = String((data as { id?: string } | null)?.id ?? "");
    if (!remoteId) {
      throw new Error("No se recibio remote_id para la sesion remota");
    }

    await markSyncQueueItemSyncedLocalFirst(item.id, remoteId);
    rememberRemoteId(state.cashSessionRemoteIds, item.entityLocalId, remoteId);
    return;
  }

  if (item.operationType === "close") {
    const payload = parsePayload<CloseCashSessionPayload>(item);
    const remoteSessionId = resolveRequiredRemoteId(
      state.cashSessionRemoteIds,
      item.entityRemoteId ?? item.entityLocalId,
      "El dia operativo"
    );

    const { error } = await supabase
      .from("cash_sessions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closing_cash: payload.closingCash ?? null,
        notes: payload.notes ?? null,
      })
      .eq("id", remoteSessionId);

    if (error) throw error;

    await markSyncQueueItemSyncedLocalFirst(item.id, remoteSessionId);
    rememberRemoteId(state.cashSessionRemoteIds, item.entityLocalId, remoteSessionId);
    return;
  }

  throw new Error(`Operacion de cash_sessions no soportada: ${item.operationType}`);
}

async function syncSaleItem(item: LocalSyncQueueItem, state: SyncReferenceState) {
  const supabase = createClient();
  const payload = parsePayload<RegisterLocalSalePayload>(item);
  const remoteCashSessionId = resolveRequiredRemoteId(
    state.cashSessionRemoteIds,
    payload.cashSessionId,
    "El dia operativo"
  );

  const rpcItems = payload.items.map((row) => ({
    product_id: resolveRequiredRemoteId(state.productRemoteIds, row.productId, "El producto"),
    quantity: Number(row.quantity),
    unit_price: Number(row.unitPrice),
  }));

  const { data, error } = await supabase.rpc("register_sale", {
    p_cash_session_id: remoteCashSessionId,
    p_payment_method: payload.paymentMethod,
    p_items: rpcItems,
    p_notes: payload.notes ?? null,
    p_amount_received: payload.amountReceived ?? null,
    p_change_given: payload.changeGiven ?? null,
    p_idempotency_key: payload.idempotencyKey ?? item.idempotencyKey ?? item.id,
  });

  if (error) throw error;

  const row = getRpcRow<{ sale_id?: string }>(data);
  const remoteSaleId = String(row?.sale_id ?? "");
  if (!remoteSaleId) {
    throw new Error("No se recibio sale_id remoto");
  }

  await markSyncQueueItemSyncedLocalFirst(item.id, remoteSaleId);
}

async function syncExpenseItem(item: LocalSyncQueueItem, state: SyncReferenceState) {
  const supabase = createClient();
  const payload = parsePayload<UpsertLocalExpensePayload>(item);
  const remoteCashSessionId = resolveRequiredRemoteId(
    state.cashSessionRemoteIds,
    payload.cashSessionId,
    "El dia operativo"
  );

  const remotePartnerId = payload.partnerId
    ? resolveRequiredRemoteId(state.partnerRemoteIds, payload.partnerId, "La socia")
    : null;

  const remoteSharedPartnerIds =
    payload.sharedPartnerIds?.map((partnerId) =>
      resolveRequiredRemoteId(state.partnerRemoteIds, partnerId, "La socia")
    ) ?? null;

  const remoteExpenseId =
    item.operationType === "update"
      ? resolveRequiredRemoteId(
          state.expenseRemoteIds,
          item.entityRemoteId ?? payload.expenseId ?? item.entityLocalId,
          "El gasto"
        )
      : null;

  const { data, error } = await supabase.rpc("upsert_expense_with_allocations", {
    p_expense_id: remoteExpenseId,
    p_cash_session_id: remoteCashSessionId,
    p_amount: Number(payload.amount),
    p_description: payload.description,
    p_scope: payload.scope,
    p_partner_id: remotePartnerId,
    p_shared_partner_ids: remoteSharedPartnerIds,
    p_idempotency_key: payload.idempotencyKey ?? item.idempotencyKey ?? item.id,
  });

  if (error) throw error;

  const row = getRpcRow<{ expense_id?: string }>(data);
  const syncedExpenseId = String(row?.expense_id ?? remoteExpenseId ?? "");
  if (!syncedExpenseId) {
    throw new Error("No se recibio expense_id remoto");
  }

  await markSyncQueueItemSyncedLocalFirst(item.id, syncedExpenseId);
  rememberRemoteId(state.expenseRemoteIds, item.entityLocalId, syncedExpenseId);
}

async function syncProductItem(item: LocalSyncQueueItem, state: SyncReferenceState) {
  const supabase = createClient();

  if (item.operationType === "insert" || item.operationType === "update") {
    const payload = parsePayload<UpsertLocalProductPayload>(item);
    const remoteOwnerId = resolveRequiredRemoteId(
      state.partnerRemoteIds,
      payload.ownerId,
      "La socia"
    );

    const remoteProductId =
      item.operationType === "update"
        ? resolveRequiredRemoteId(
            state.productRemoteIds,
            item.entityRemoteId ?? payload.remoteId ?? item.entityLocalId,
            "El producto"
          )
        : null;

    const { data, error } = await supabase.rpc("upsert_product_with_movement", {
      p_product_id: remoteProductId,
      p_barcode: payload.barcode,
      p_name: payload.name,
      p_description: payload.description ?? null,
      p_category: payload.category ?? null,
      p_owner_id: remoteOwnerId,
      p_purchase_price: Number(payload.purchasePrice ?? 0),
      p_sale_price: Number(payload.salePrice),
      p_stock: Number(payload.stock),
      p_min_stock: Number(payload.minStock),
      p_is_active: payload.isActive,
      p_sku: payload.sku ?? null,
    });

    if (error) throw error;

    const row = getRpcRow<{ product_id?: string }>(data);
    const syncedProductId = String(row?.product_id ?? remoteProductId ?? "");
    if (!syncedProductId) {
      throw new Error("No se recibio product_id remoto");
    }

    await markSyncQueueItemSyncedLocalFirst(item.id, syncedProductId);
    rememberRemoteId(state.productRemoteIds, item.entityLocalId, syncedProductId);
    return;
  }

  if (item.operationType === "create_remate") {
    const payload = parsePayload<CreateRematePayload>(item);
    const remoteProductId = resolveRequiredRemoteId(
      state.productRemoteIds,
      item.entityRemoteId ?? payload.productId ?? item.entityLocalId,
      "El producto"
    );

    const { error } = await supabase.rpc("create_remate", {
      p_product_id: remoteProductId,
      p_clearance_price: Number(payload.clearancePrice),
      p_stock: Number(payload.stock),
    });

    if (error) throw error;

    await markSyncQueueItemSyncedLocalFirst(item.id, remoteProductId);
    rememberRemoteId(state.productRemoteIds, item.entityLocalId, remoteProductId);
    return;
  }

  if (item.operationType === "dispose") {
    const payload = parsePayload<DisposeProductPayload>(item);
    const remoteProductId = resolveRequiredRemoteId(
      state.productRemoteIds,
      item.entityRemoteId ?? payload.productId ?? item.entityLocalId,
      "El producto"
    );

    const { error } = await supabase.rpc("dispose_product", {
      p_product_id: remoteProductId,
    });

    if (error) throw error;

    await markSyncQueueItemSyncedLocalFirst(item.id, remoteProductId);
    rememberRemoteId(state.productRemoteIds, item.entityLocalId, remoteProductId);
    return;
  }

  throw new Error(`Operacion de products no soportada: ${item.operationType}`);
}

async function syncInventoryMovementItem(
  item: LocalSyncQueueItem,
  state: SyncReferenceState
) {
  const supabase = createClient();
  const payload = parsePayload<AdjustInventoryPayload>(item);
  const remoteProductId = resolveRequiredRemoteId(
    state.productRemoteIds,
    item.entityRemoteId ?? payload.productId ?? item.entityLocalId,
    "El producto"
  );

  const { error } = await supabase.rpc("adjust_product_stock", {
    p_product_id: remoteProductId,
    p_quantity: Number(payload.quantity),
    p_operation: payload.operation,
    p_reason: payload.reason,
  });

  if (error) throw error;

  await markSyncQueueItemSyncedLocalFirst(item.id, remoteProductId);
}

async function runDesktopOperation(item: LocalSyncQueueItem, state: SyncReferenceState) {
  if (item.entityName === "cash_sessions") {
    await syncCashSessionItem(item, state);
    return;
  }

  if (item.entityName === "sales") {
    await syncSaleItem(item, state);
    return;
  }

  if (item.entityName === "expenses") {
    await syncExpenseItem(item, state);
    return;
  }

  if (item.entityName === "products") {
    await syncProductItem(item, state);
    return;
  }

  if (item.entityName === "inventory_movements") {
    await syncInventoryMovementItem(item, state);
    return;
  }

  throw new Error(`Entidad de sync no soportada: ${item.entityName}`);
}

async function doSyncDesktopQueue(): Promise<DesktopSyncResult> {
  const result: DesktopSyncResult = {
    processed: 0,
    synced: 0,
    failed: 0,
    stopped_by_connectivity: false,
  };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    result.stopped_by_connectivity = true;
    return result;
  }

  await invoke<number>("ensure_local_cash_sessions_sync_queued");

  const state = await loadReferenceState();
  const pendingItems = (await listSyncQueueLocalFirst())
    .filter((item) => item.status === "pending" && isItemDue(item))
    .sort((left, right) => {
      const priorityDiff = getSyncPriority(left) - getSyncPriority(right);
      if (priorityDiff !== 0) return priorityDiff;
      return left.createdAt.localeCompare(right.createdAt);
    });

  for (const item of pendingItems) {
    result.processed += 1;

    try {
      await runDesktopOperation(item, state);
      result.synced += 1;
    } catch (error) {
      const message = normalizeErrorMessage(error);

      if (error instanceof RetryableSyncError) {
        await markSyncQueueItemFailedLocalFirst(item.id, message, true);
        continue;
      }

      if (isConnectivityError(error)) {
        await markSyncQueueItemFailedLocalFirst(item.id, message, true);
        result.stopped_by_connectivity = true;
        break;
      }

      await markSyncQueueItemFailedLocalFirst(item.id, message, false);
      result.failed += 1;
    }
  }

  return result;
}

export async function syncDesktopQueue() {
  if (currentDesktopSyncPromise) return currentDesktopSyncPromise;

  currentDesktopSyncPromise = doSyncDesktopQueue().finally(() => {
    currentDesktopSyncPromise = null;
  });

  return currentDesktopSyncPromise;
}

