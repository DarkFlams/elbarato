"use client";

import { createClient } from "@/lib/supabase/client";
import {
  getOfflineQueue,
  isConnectivityError,
  markOfflineOperationResult,
  removeOfflineOperation,
} from "@/lib/offline/queue";
import type { OfflineOperation, SyncOfflineResult } from "@/lib/offline/types";

let currentSyncPromise: Promise<SyncOfflineResult> | null = null;

function normalizeErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown sync error";
}

async function runOperation(operation: OfflineOperation) {
  const supabase = createClient();

  if (operation.type === "register_sale") {
    const { error } = await supabase.rpc("register_sale", operation.payload);
    if (error) throw error;
    return;
  }

  if (operation.type === "upsert_expense") {
    const { error } = await supabase.rpc(
      "upsert_expense_with_allocations",
      operation.payload
    );
    if (error) throw error;
  }
}

async function doSyncOfflineQueue(): Promise<SyncOfflineResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      processed: 0,
      synced: 0,
      failed: 0,
      stopped_by_connectivity: true,
    };
  }

  const pendingQueue = getOfflineQueue()
    .filter((operation) => operation.status === "pending")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const result: SyncOfflineResult = {
    processed: 0,
    synced: 0,
    failed: 0,
    stopped_by_connectivity: false,
  };

  for (const operation of pendingQueue) {
    result.processed += 1;

    try {
      await runOperation(operation);
      removeOfflineOperation(operation.id);
      result.synced += 1;
    } catch (error) {
      const message = normalizeErrorMessage(error);
      const connectivity = isConnectivityError(error);

      markOfflineOperationResult(operation.id, {
        errorMessage: message,
        status: connectivity ? "pending" : "failed",
      });

      if (connectivity) {
        result.stopped_by_connectivity = true;
        break;
      }

      result.failed += 1;
    }
  }

  return result;
}

export async function syncOfflineQueue() {
  if (currentSyncPromise) return currentSyncPromise;

  currentSyncPromise = doSyncOfflineQueue().finally(() => {
    currentSyncPromise = null;
  });

  return currentSyncPromise;
}
