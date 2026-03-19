"use client";

import { invoke } from "@tauri-apps/api/core";
import { registerSaleWithOfflineFallback } from "@/lib/offline/rpc";
import { createClient } from "@/lib/supabase/client";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";

interface RegisterSaleLocalFirstInput {
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

interface LocalSaleResult {
  saleId: string;
  total: number;
  itemCount: number;
}

interface LocalSessionSalesStats {
  totalSales: number;
  totalCash: number;
  totalTransfer: number;
  saleCount: number;
}

export async function registerSaleLocalFirst(input: RegisterSaleLocalFirstInput) {
  if (!isTauriRuntime()) {
    const idempotencyKey =
      input.idempotencyKey ??
      (globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    return registerSaleWithOfflineFallback({
      p_cash_session_id: input.cashSessionId,
      p_payment_method: input.paymentMethod,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
      })),
      p_notes: input.notes ?? null,
      p_amount_received: input.amountReceived ?? null,
      p_change_given: input.changeGiven ?? null,
      p_idempotency_key: idempotencyKey,
    });
  }

  try {
    const result = await invoke<LocalSaleResult>("register_local_sale", {
      input: {
        cashSessionId: input.cashSessionId,
        paymentMethod: input.paymentMethod,
        items: input.items,
        notes: input.notes ?? null,
        amountReceived: input.amountReceived ?? null,
        changeGiven: input.changeGiven ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    return {
      mode: "local" as const,
      data: {
        sale_id: result.saleId,
        total: result.total,
        item_count: result.itemCount,
      },
    };
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[sales] register_local_sale unavailable, using remote fallback");
    const idempotencyKey =
      input.idempotencyKey ??
      (globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    return registerSaleWithOfflineFallback({
      p_cash_session_id: input.cashSessionId,
      p_payment_method: input.paymentMethod,
      p_items: input.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
      })),
      p_notes: input.notes ?? null,
      p_amount_received: input.amountReceived ?? null,
      p_change_given: input.changeGiven ?? null,
      p_idempotency_key: idempotencyKey,
    });
  }
}

export async function getSessionSalesStatsLocalFirst(cashSessionId: string) {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("sales")
      .select("id, total, payment_method")
      .eq("cash_session_id", cashSessionId);

    if (error) throw error;

    const rows =
      (data as Array<{ id: string; total: number | string; payment_method: string }>) || [];

    return rows.reduce<LocalSessionSalesStats>(
      (acc, row) => {
        const amount = Number(row.total) || 0;
        acc.totalSales += amount;
        acc.saleCount += 1;
        if (row.payment_method === "cash") acc.totalCash += amount;
        if (row.payment_method === "transfer") acc.totalTransfer += amount;
        return acc;
      },
      {
        totalSales: 0,
        totalCash: 0,
        totalTransfer: 0,
        saleCount: 0,
      }
    );
  }

  try {
    return await invoke<LocalSessionSalesStats>("get_local_session_sales_stats", {
      cashSessionId,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[sales] get_local_session_sales_stats unavailable, using Supabase fallback");
    const supabase = createClient();
    const { data, error: remoteError } = await supabase
      .from("sales")
      .select("id, total, payment_method")
      .eq("cash_session_id", cashSessionId);

    if (remoteError) throw remoteError;

    const rows =
      (data as Array<{ id: string; total: number | string; payment_method: string }>) || [];

    return rows.reduce<LocalSessionSalesStats>(
      (acc, row) => {
        const amount = Number(row.total) || 0;
        acc.totalSales += amount;
        acc.saleCount += 1;
        if (row.payment_method === "cash") acc.totalCash += amount;
        if (row.payment_method === "transfer") acc.totalTransfer += amount;
        return acc;
      },
      {
        totalSales: 0,
        totalCash: 0,
        totalTransfer: 0,
        saleCount: 0,
      }
    );
  }
}
