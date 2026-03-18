"use client";

import { createClient } from "@/lib/supabase/client";
import {
  enqueueRegisterSale,
  enqueueUpsertExpense,
  isConnectivityError,
} from "@/lib/offline/queue";
import type {
  RegisterSaleRpcParams,
  UpsertExpenseRpcParams,
} from "@/lib/offline/types";

export interface RegisterSaleResult {
  sale_id: string;
  total: number;
  item_count: number;
}

type OfflineMutationResult<TData> =
  | { mode: "online"; data: TData }
  | { mode: "queued"; operation_id: string };

function isOfflineNow() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

export async function registerSaleWithOfflineFallback(
  payload: RegisterSaleRpcParams
): Promise<OfflineMutationResult<RegisterSaleResult>> {
  if (isOfflineNow()) {
    const operation = enqueueRegisterSale(payload);
    return { mode: "queued", operation_id: operation.id };
  }

  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("register_sale", payload);
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.sale_id) {
      throw new Error("No valid response from register_sale");
    }

    return {
      mode: "online",
      data: {
        sale_id: String(row.sale_id),
        total: Number(row.total ?? 0),
        item_count: Number(row.item_count ?? 0),
      },
    };
  } catch (error) {
    if (!isConnectivityError(error)) throw error;

    const operation = enqueueRegisterSale(payload);
    return { mode: "queued", operation_id: operation.id };
  }
}

export async function upsertExpenseWithOfflineFallback(
  payload: UpsertExpenseRpcParams
): Promise<OfflineMutationResult<{ expense_id: string | null }>> {
  const isEdit = Boolean(payload.p_expense_id);

  if (isEdit && isOfflineNow()) {
    throw new Error(
      "La edicion de gastos no esta disponible offline. Reconecta internet para editar."
    );
  }

  if (!isEdit && isOfflineNow()) {
    const operation = enqueueUpsertExpense(payload);
    return { mode: "queued", operation_id: operation.id };
  }

  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc(
      "upsert_expense_with_allocations",
      payload
    );
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return {
      mode: "online",
      data: {
        expense_id: row?.expense_id ?? payload.p_expense_id ?? null,
      },
    };
  } catch (error) {
    if (isEdit || !isConnectivityError(error)) throw error;

    const operation = enqueueUpsertExpense(payload);
    return { mode: "queued", operation_id: operation.id };
  }
}
