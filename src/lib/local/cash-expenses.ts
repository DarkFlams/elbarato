"use client";

import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";
import {
  ecuadorDateEndUtcIso,
  ecuadorDateStartUtcIso,
  toEcuadorDateInput,
} from "@/lib/timezone-ecuador";
import type { CashSession, Expense, ExpenseAllocation, Partner } from "@/types/database";
import { getCatalogPartners } from "./catalog";
import { upsertExpenseWithOfflineFallback } from "@/lib/offline/rpc";

interface LocalCashSessionRecord extends CashSession {
  remote_id?: string | null;
}

interface LocalPartnerRecord extends Partner {
  remote_id?: string | null;
}

interface LocalExpenseAllocationRecord extends ExpenseAllocation {
  partner: LocalPartnerRecord;
}

interface LocalExpenseRecord extends Expense {
  remote_id?: string | null;
  expense_allocations: LocalExpenseAllocationRecord[];
}

interface UpsertExpenseInput {
  expenseId?: string | null;
  cashSessionId: string;
  amount: number;
  description: string;
  scope: "individual" | "shared";
  partnerId?: string | null;
  sharedPartnerIds?: string[] | null;
  idempotencyKey?: string | null;
}

function normalizePartnerDisplayName(name: string | null | undefined, displayName: string): string {
  if ((name || "").toLowerCase() === "todos") {
    return "Medias";
  }
  return displayName;
}

function mapLocalCashSession(record: LocalCashSessionRecord): CashSession {
  return {
    ...record,
    id: record.remote_id || record.id,
  };
}

function mapLocalExpense(record: LocalExpenseRecord): LocalExpenseRecord {
  return {
    ...record,
    id: record.remote_id || record.id,
    cash_session_id: record.cash_session_id,
    expense_allocations: record.expense_allocations.map((allocation) => ({
      ...allocation,
      partner_id: allocation.partner.remote_id || allocation.partner.id,
      partner: {
        ...allocation.partner,
        id: allocation.partner.remote_id || allocation.partner.id,
        display_name: normalizePartnerDisplayName(
          allocation.partner.name,
          allocation.partner.display_name
        ),
      },
    })),
  };
}

function getLocalDayBounds() {
  const day = toEcuadorDateInput(new Date());
  const start = ecuadorDateStartUtcIso(day);
  const end = ecuadorDateEndUtcIso(day);
  return {
    startIso: start,
    endIso: end,
  };
}

export async function getOpenCashSessionLocalFirst() {
  if (!isTauriRuntime()) {
    const { startIso, endIso } = getLocalDayBounds();
    const supabase = createClient();
    const { data, error } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("status", "open")
      .gte("opened_at", startIso)
      .lte("opened_at", endIso)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data as CashSession | null) ?? null;
  }

  try {
    const session = await invoke<LocalCashSessionRecord | null>("get_open_local_cash_session");
    return session ? mapLocalCashSession(session) : null;
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[cash-expenses] get_open_local_cash_session unavailable, using Supabase fallback");
    const { startIso, endIso } = getLocalDayBounds();
    const supabase = createClient();
    const { data, error: remoteError } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("status", "open")
      .gte("opened_at", startIso)
      .lte("opened_at", endIso)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (remoteError) throw remoteError;
    return (data as CashSession | null) ?? null;
  }
}

export async function openCashSessionLocalFirst(openingCash = 0) {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { startIso, endIso } = getLocalDayBounds();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: existingSession, error: existingError } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("status", "open")
      .gte("opened_at", startIso)
      .lte("opened_at", endIso)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existingSession) return existingSession as CashSession;

    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({
        opened_by: user?.id ?? null,
        opening_cash: openingCash,
        status: "open",
      })
      .select()
      .single();

    if (error) throw error;
    return data as CashSession;
  }

  try {
    const session = await invoke<LocalCashSessionRecord>("open_local_cash_session", {
      openingCash,
    });
    return mapLocalCashSession(session);
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[cash-expenses] open_local_cash_session unavailable, using Supabase fallback");
    const supabase = createClient();
    const { startIso, endIso } = getLocalDayBounds();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: existingSession, error: existingError } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("status", "open")
      .gte("opened_at", startIso)
      .lte("opened_at", endIso)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existingSession) return existingSession as CashSession;

    const { data, error: remoteError } = await supabase
      .from("cash_sessions")
      .insert({
        opened_by: user?.id ?? null,
        opening_cash: openingCash,
        status: "open",
      })
      .select()
      .single();

    if (remoteError) throw remoteError;
    return data as CashSession;
  }
}

export async function closeCashSessionLocalFirst(
  sessionId: string,
  closingCash?: number,
  notes?: string
) {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { error } = await supabase
      .from("cash_sessions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closing_cash: closingCash ?? null,
        notes: notes ?? null,
      })
      .eq("id", sessionId);

    if (error) throw error;
    return true;
  }

  try {
    return await invoke<boolean>("close_local_cash_session", {
      sessionId,
      closingCash: closingCash ?? null,
      notes: notes ?? null,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[cash-expenses] close_local_cash_session unavailable, using Supabase fallback");
    const supabase = createClient();
    const { error: remoteError } = await supabase
      .from("cash_sessions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closing_cash: closingCash ?? null,
        notes: notes ?? null,
      })
      .eq("id", sessionId);

    if (remoteError) throw remoteError;
    return true;
  }
}

export async function getSessionExpensesLocalFirst(cashSessionId: string) {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("expenses")
      .select(
        `
        *,
        expense_allocations (
          *,
          partner:partners!expense_allocations_partner_id_fkey (
            id, name, display_name, color_hex, is_expense_eligible, created_at
          )
        )
      `
      )
      .eq("cash_session_id", cashSessionId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return ((data as LocalExpenseRecord[]) || []).map(mapLocalExpense);
  }

  try {
    const expenses = await invoke<LocalExpenseRecord[]>("list_local_expenses", {
      cashSessionId,
    });
    return expenses.map(mapLocalExpense);
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[cash-expenses] list_local_expenses unavailable, using Supabase fallback");
    const supabase = createClient();
    const { data, error: remoteError } = await supabase
      .from("expenses")
      .select(
        `
        *,
        expense_allocations (
          *,
          partner:partners!expense_allocations_partner_id_fkey (
            id, name, display_name, color_hex, is_expense_eligible, created_at
          )
        )
      `
      )
      .eq("cash_session_id", cashSessionId)
      .order("created_at", { ascending: false });

    if (remoteError) throw remoteError;
    return ((data as LocalExpenseRecord[]) || []).map(mapLocalExpense);
  }
}

export async function upsertExpenseLocalFirst(input: UpsertExpenseInput) {
  if (!isTauriRuntime()) {
    return upsertExpenseWithOfflineFallback({
      p_expense_id: input.expenseId ?? null,
      p_cash_session_id: input.cashSessionId,
      p_amount: input.amount,
      p_description: input.description,
      p_scope: input.scope,
      p_partner_id: input.partnerId ?? null,
      p_shared_partner_ids: input.sharedPartnerIds ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
  }

  try {
    const result = await invoke<{ expenseId: string; allocationCount: number }>("upsert_local_expense", {
      input: {
        expenseId: input.expenseId ?? null,
        cashSessionId: input.cashSessionId,
        amount: input.amount,
        description: input.description,
        scope: input.scope,
        partnerId: input.partnerId ?? null,
        sharedPartnerIds: input.sharedPartnerIds ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    return {
      mode: "local" as const,
      data: {
        expense_id: result.expenseId,
        allocation_count: result.allocationCount,
      },
    };
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[cash-expenses] upsert_local_expense unavailable, using remote fallback");
    return upsertExpenseWithOfflineFallback({
      p_expense_id: input.expenseId ?? null,
      p_cash_session_id: input.cashSessionId,
      p_amount: input.amount,
      p_description: input.description,
      p_scope: input.scope,
      p_partner_id: input.partnerId ?? null,
      p_shared_partner_ids: input.sharedPartnerIds ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
  }
}

export async function getExpenseEligiblePartnersLocalFirst() {
  const partners = await getCatalogPartners();
  return partners.filter(
    (partner) => partner.is_expense_eligible && partner.name.toLowerCase() !== "todos"
  );
}

export async function getExpensePartnersLocalFirst() {
  return await getCatalogPartners();
}
