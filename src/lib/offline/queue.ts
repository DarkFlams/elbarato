"use client";

import type {
  OfflineOperation,
  OfflineQueueStats,
  RegisterSaleRpcParams,
  UpsertExpenseRpcParams,
} from "@/lib/offline/types";

const OFFLINE_QUEUE_STORAGE_KEY = "pos_offline_queue_v1";
export const OFFLINE_QUEUE_EVENT_NAME = "pos-offline-queue-updated";

function isBrowser() {
  return typeof window !== "undefined";
}

function emitQueueUpdated() {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_EVENT_NAME));
}

function safeReadQueue(): OfflineOperation[] {
  if (!isBrowser()) return [];

  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineOperation[]) : [];
  } catch {
    return [];
  }
}

function safeWriteQueue(queue: OfflineOperation[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  emitQueueUpdated();
}

function buildOperationId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function extractOperationIdempotencyKey(
  operation: OfflineOperation
): string | null {
  if (operation.type === "register_sale") {
    return operation.payload.p_idempotency_key ?? null;
  }

  return operation.payload.p_idempotency_key ?? null;
}

function findExistingOperation(
  queue: OfflineOperation[],
  type: OfflineOperation["type"],
  idempotencyKey: string | null
) {
  if (!idempotencyKey) return null;

  return (
    queue.find(
      (operation) =>
        operation.type === type &&
        extractOperationIdempotencyKey(operation) === idempotencyKey
    ) ?? null
  );
}

export function getOfflineQueue() {
  return safeReadQueue();
}

export function getOfflineQueueStats(): OfflineQueueStats {
  const queue = safeReadQueue();
  const pending = queue.filter((operation) => operation.status === "pending")
    .length;
  const failed = queue.filter((operation) => operation.status === "failed")
    .length;

  return {
    total: queue.length,
    pending,
    failed,
  };
}

export function enqueueRegisterSale(
  payload: RegisterSaleRpcParams
): OfflineOperation {
  const queue = safeReadQueue();
  const existing = findExistingOperation(
    queue,
    "register_sale",
    payload.p_idempotency_key
  );
  if (existing) return existing;

  const operation: OfflineOperation = {
    id: buildOperationId(),
    type: "register_sale",
    status: "pending",
    payload,
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
  };

  safeWriteQueue([operation, ...queue]);
  return operation;
}

export function enqueueUpsertExpense(
  payload: UpsertExpenseRpcParams
): OfflineOperation {
  const queue = safeReadQueue();
  const existing = findExistingOperation(
    queue,
    "upsert_expense",
    payload.p_idempotency_key
  );
  if (existing) return existing;

  const operation: OfflineOperation = {
    id: buildOperationId(),
    type: "upsert_expense",
    status: "pending",
    payload,
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
  };

  safeWriteQueue([operation, ...queue]);
  return operation;
}

export function removeOfflineOperation(operationId: string) {
  const queue = safeReadQueue();
  const next = queue.filter((operation) => operation.id !== operationId);
  safeWriteQueue(next);
}

export function requeueOfflineOperation(operationId: string) {
  const queue = safeReadQueue();
  let updated = false;

  const next = queue.map((operation) => {
    if (operation.id !== operationId) return operation;

    updated = true;
    return {
      ...operation,
      status: "pending" as const,
      last_error: null,
    };
  });

  if (updated) safeWriteQueue(next);
  return updated;
}

export function requeueAllFailedOfflineOperations() {
  const queue = safeReadQueue();
  let changedCount = 0;

  const next = queue.map((operation) => {
    if (operation.status !== "failed") return operation;

    changedCount += 1;
    return {
      ...operation,
      status: "pending" as const,
      last_error: null,
    };
  });

  if (changedCount > 0) safeWriteQueue(next);
  return changedCount;
}

export function markOfflineOperationResult(
  operationId: string,
  options: { errorMessage: string | null; status: "pending" | "failed" }
) {
  const queue = safeReadQueue();
  const next = queue.map((operation) => {
    if (operation.id !== operationId) return operation;

    return {
      ...operation,
      status: options.status,
      attempts: operation.attempts + 1,
      last_error: options.errorMessage,
      last_attempt_at: new Date().toISOString(),
    };
  });

  safeWriteQueue(next);
}

export function subscribeOfflineQueue(listener: () => void) {
  if (!isBrowser()) return () => {};

  window.addEventListener(OFFLINE_QUEUE_EVENT_NAME, listener);
  return () => window.removeEventListener(OFFLINE_QUEUE_EVENT_NAME, listener);
}

export function isConnectivityError(error: unknown) {
  if (!error) return false;

  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
      ? error.message
      : "";

  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("network request failed") ||
    normalized.includes("network error") ||
    normalized.includes("fetch failed") ||
    normalized.includes("load failed")
  );
}
