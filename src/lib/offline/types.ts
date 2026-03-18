export type OfflineOperationType = "register_sale" | "upsert_expense";
export type OfflineOperationStatus = "pending" | "failed";

export interface RegisterSaleRpcParams {
  p_cash_session_id: string;
  p_payment_method: "cash" | "transfer";
  p_items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
  }>;
  p_notes: string | null;
  p_amount_received: number | null;
  p_change_given: number | null;
  p_idempotency_key: string;
}

export interface UpsertExpenseRpcParams {
  p_expense_id: string | null;
  p_cash_session_id: string | null;
  p_amount: number | null;
  p_description: string | null;
  p_scope: "individual" | "shared";
  p_partner_id: string | null;
  p_shared_partner_ids: string[] | null;
  p_idempotency_key: string | null;
}

interface OfflineOperationBase<TType extends OfflineOperationType, TPayload> {
  id: string;
  type: TType;
  status: OfflineOperationStatus;
  payload: TPayload;
  created_at: string;
  attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
}

export type OfflineRegisterSaleOperation = OfflineOperationBase<
  "register_sale",
  RegisterSaleRpcParams
>;

export type OfflineUpsertExpenseOperation = OfflineOperationBase<
  "upsert_expense",
  UpsertExpenseRpcParams
>;

export type OfflineOperation =
  | OfflineRegisterSaleOperation
  | OfflineUpsertExpenseOperation;

export interface OfflineQueueStats {
  total: number;
  pending: number;
  failed: number;
}

export interface SyncOfflineResult {
  processed: number;
  synced: number;
  failed: number;
  stopped_by_connectivity: boolean;
}
