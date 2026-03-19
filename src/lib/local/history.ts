"use client";

import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";
import type { CashSession, CashSessionReport, Expense, ExpenseAllocation, Partner } from "@/types/database";
import type { SaleDetailData } from "@/components/sales/sale-detail-drawer";

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

interface LocalSaleHistoryItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  owner_id: string;
  partner: LocalPartnerRecord | null;
}

interface LocalSaleHistory {
  id: string;
  remote_id?: string | null;
  created_at: string;
  total: number;
  payment_method: string;
  sold_by_partner: LocalPartnerRecord | null;
  sale_items: LocalSaleHistoryItem[];
}

interface LocalCashSessionRecord extends CashSession {
  remote_id?: string | null;
}

interface LocalCashSessionReportRow extends CashSessionReport {
  partner_id: string;
}

function normalizeSale(sale: LocalSaleHistory): SaleDetailData {
  return {
    id: sale.remote_id || sale.id,
    created_at: sale.created_at,
    total: Number(sale.total || 0),
    payment_method: sale.payment_method,
    sold_by_partner: sale.sold_by_partner
      ? {
          display_name: sale.sold_by_partner.display_name,
          color_hex: sale.sold_by_partner.color_hex,
          name: sale.sold_by_partner.name,
        }
      : null,
    sale_items: sale.sale_items.map((item) => ({
      id: item.id,
      product_name: item.product_name,
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
      subtotal: Number(item.subtotal || 0),
      owner_id: item.partner?.remote_id || item.partner?.id || item.owner_id,
      partner: item.partner
        ? {
            display_name: item.partner.display_name,
            color_hex: item.partner.color_hex,
            name: item.partner.name,
          }
        : null,
    })),
  };
}

export async function getSalesHistoryLocalFirst(fromDate?: string, toDate?: string) {
  if (!isTauriRuntime()) {
    return getSalesHistoryRemote(fromDate, toDate);
  }

  try {
    const sales = await invoke<LocalSaleHistory[]>("list_local_sales", {
      fromDate: fromDate || null,
      toDate: toDate || null,
    });
    return sales.map(normalizeSale);
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return getSalesHistoryRemote(fromDate, toDate);
  }
}

async function getSalesHistoryRemote(fromDate?: string, toDate?: string) {
  const supabase = createClient();
  let query = supabase
    .from("sales")
    .select(
      `
      id,
      created_at,
      total,
      payment_method,
      sold_by,
      sale_items(
        id,
        product_name,
        quantity,
        unit_price,
        subtotal,
        owner_id,
        partner:partners!sale_items_owner_id_fkey (
          id, name, display_name, color_hex, is_expense_eligible, created_at
        )
      )
    `
    )
    .order("created_at", { ascending: false });

  if (fromDate) query = query.gte("created_at", `${fromDate}T00:00:00`);
  if (toDate) query = query.lte("created_at", `${toDate}T23:59:59.999`);
  if (!fromDate && !toDate) query = query.limit(50);

  const { data, error } = await query;
  if (error) throw error;

  return ((data as LocalSaleHistory[]) || []).map(normalizeSale);
}

export async function getCashSessionsHistoryLocalFirst(fromDate?: string, toDate?: string) {
  if (!isTauriRuntime()) {
    return getCashSessionsHistoryRemote(fromDate, toDate);
  }

  try {
    const sessions = await invoke<LocalCashSessionRecord[]>("list_local_cash_sessions", {
      fromDate: fromDate || null,
      toDate: toDate || null,
      limit: !fromDate && !toDate ? 30 : null,
    });

    return sessions.map((session) => ({
      ...session,
      id: session.remote_id || session.id,
    })) as CashSession[];
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return getCashSessionsHistoryRemote(fromDate, toDate);
  }
}

async function getCashSessionsHistoryRemote(fromDate?: string, toDate?: string) {
  const supabase = createClient();
  let query = supabase.from("cash_sessions").select("*").order("opened_at", { ascending: false });

  if (fromDate) query = query.gte("opened_at", `${fromDate}T00:00:00`);
  if (toDate) query = query.lte("opened_at", `${toDate}T23:59:59.999`);
  if (!fromDate && !toDate) query = query.limit(30);

  const { data, error } = await query;
  if (error) throw error;
  return (data as CashSession[]) || [];
}

export async function getCashSessionReportLocalFirst(sessionId: string) {
  if (!isTauriRuntime()) {
    return getCashSessionReportRemote(sessionId);
  }

  try {
    return await invoke<LocalCashSessionReportRow[]>("get_local_cash_session_report", {
      cashSessionId: sessionId,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return getCashSessionReportRemote(sessionId);
  }
}

async function getCashSessionReportRemote(sessionId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_cash_session_report")
    .select("*")
    .eq("session_id", sessionId);
  if (error) throw error;
  return (data as LocalCashSessionReportRow[]) || [];
}

export async function getExpensesBySessionLocalFirst(sessionId: string) {
  if (!isTauriRuntime()) {
    return getExpensesBySessionRemote(sessionId);
  }

  try {
    return await invoke<LocalExpenseRecord[]>("list_local_expenses", {
      cashSessionId: sessionId,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return getExpensesBySessionRemote(sessionId);
  }
}

async function getExpensesBySessionRemote(sessionId: string) {
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
    .eq("cash_session_id", sessionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as LocalExpenseRecord[]) || [];
}
