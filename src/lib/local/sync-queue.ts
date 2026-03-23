"use client";

import { invoke } from "@tauri-apps/api/core";
import {
  getOfflineQueue,
  getOfflineQueueStats,
  markOfflineOperationResult,
  removeOfflineOperation,
  requeueAllFailedOfflineOperations,
  requeueOfflineOperation,
} from "@/lib/offline/queue";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";

export interface LocalSyncQueueItem {
  id: string;
  entityName: string;
  entityLocalId: string;
  entityRemoteId: string | null;
  operationType: string;
  payloadJson: string;
  idempotencyKey: string | null;
  status: string;
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalSyncQueueStats {
  total: number;
  pending: number;
  failed: number;
}

export type SyncQueueStatusFilter = "all" | "pending" | "failed";

export function isDesktopSyncQueueEnabled() {
  return isTauriRuntime();
}

export async function getSyncQueueStatsLocalFirst(): Promise<LocalSyncQueueStats> {
  if (!isTauriRuntime()) {
    return getOfflineQueueStats();
  }

  try {
    return await invoke<LocalSyncQueueStats>("get_local_sync_queue_stats");
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return getOfflineQueueStats();
  }
}

export async function listSyncQueueLocalFirst(): Promise<LocalSyncQueueItem[]> {
  if (!isTauriRuntime()) {
    return getOfflineQueue().map((item) => ({
      id: item.id,
      entityName: item.type === "register_sale" ? "sales" : "expenses",
      entityLocalId: item.id,
      entityRemoteId: null,
      operationType: item.type === "register_sale" ? "insert" : "upsert",
      payloadJson: JSON.stringify(item.payload),
      idempotencyKey:
        item.type === "register_sale"
          ? item.payload.p_idempotency_key
          : item.payload.p_idempotency_key,
      status: item.status,
      attempts: item.attempts,
      nextRetryAt: null,
      lastError: item.last_error,
      createdAt: item.created_at,
      updatedAt: item.last_attempt_at ?? item.created_at,
    }));
  }

  try {
    return await invoke<LocalSyncQueueItem[]>("list_local_sync_queue");
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;

    return getOfflineQueue().map((item) => ({
      id: item.id,
      entityName: item.type === "register_sale" ? "sales" : "expenses",
      entityLocalId: item.id,
      entityRemoteId: null,
      operationType: item.type === "register_sale" ? "insert" : "upsert",
      payloadJson: JSON.stringify(item.payload),
      idempotencyKey:
        item.type === "register_sale"
          ? item.payload.p_idempotency_key
          : item.payload.p_idempotency_key,
      status: item.status,
      attempts: item.attempts,
      nextRetryAt: null,
      lastError: item.last_error,
      createdAt: item.created_at,
      updatedAt: item.last_attempt_at ?? item.created_at,
    }));
  }
}

export async function listSyncQueuePreviewLocalFirst(options?: {
  limit?: number;
  status?: SyncQueueStatusFilter;
}): Promise<LocalSyncQueueItem[]> {
  const limit = Math.max(1, Math.trunc(options?.limit ?? 200));
  const status = options?.status ?? "all";

  if (!isTauriRuntime()) {
    const items = await listSyncQueueLocalFirst();
    const filtered =
      status === "all" ? items : items.filter((item) => item.status === status);
    return filtered.slice(0, limit);
  }

  try {
    return await invoke<LocalSyncQueueItem[]>("list_local_sync_queue_preview", {
      limit,
      status,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;

    const items = await listSyncQueueLocalFirst();
    const filtered =
      status === "all" ? items : items.filter((item) => item.status === status);
    return filtered.slice(0, limit);
  }
}

export async function removeSyncQueueItemLocalFirst(itemId: string) {
  if (!isTauriRuntime()) {
    removeOfflineOperation(itemId);
    return true;
  }

  try {
    return await invoke<boolean>("remove_local_sync_queue_item", { itemId });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    removeOfflineOperation(itemId);
    return true;
  }
}

export async function markSyncQueueItemSyncedLocalFirst(
  itemId: string,
  entityRemoteId?: string | null
) {
  if (!isTauriRuntime()) {
    removeOfflineOperation(itemId);
    return true;
  }

  try {
    return await invoke<boolean>("mark_local_sync_queue_item_synced", {
      itemId,
      entityRemoteId: entityRemoteId ?? null,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    removeOfflineOperation(itemId);
    return true;
  }
}

export async function markSyncQueueItemFailedLocalFirst(
  itemId: string,
  errorMessage: string,
  retryable = false
) {
  if (!isTauriRuntime()) {
    markOfflineOperationResult(itemId, {
      errorMessage,
      status: retryable ? "pending" : "failed",
    });
    return true;
  }

  try {
    return await invoke<boolean>("mark_local_sync_queue_item_failed", {
      itemId,
      errorMessage,
      retryable,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    markOfflineOperationResult(itemId, {
      errorMessage,
      status: retryable ? "pending" : "failed",
    });
    return true;
  }
}

export async function requeueSyncQueueItemLocalFirst(itemId: string) {
  if (!isTauriRuntime()) {
    return requeueOfflineOperation(itemId);
  }

  try {
    return await invoke<boolean>("requeue_local_sync_queue_item", { itemId });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return requeueOfflineOperation(itemId);
  }
}

export async function requeueAllFailedSyncQueueItemsLocalFirst() {
  if (!isTauriRuntime()) {
    return requeueAllFailedOfflineOperations();
  }

  try {
    return await invoke<number>("requeue_all_failed_local_sync_queue_items");
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return requeueAllFailedOfflineOperations();
  }
}
