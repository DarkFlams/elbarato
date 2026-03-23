"use client";

import { createClient } from "@/lib/supabase/client";
import { getPartnerConfigFromPartner } from "@/lib/partners";
import { getErrorMessage } from "@/lib/error-utils";

export const STOCK_MOBILE_SESSION_STORAGE_KEY = "stock_mobile_session_v1";

type RpcRow<T> = T | T[] | null;
type RpcResponse<T> = { data: RpcRow<T>; error: unknown };

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function getSingleRpcRow<T>(data: RpcRow<T>, functionName: string): T {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new Error(`La funcion ${functionName} no devolvio datos.`);
    }
    return data[0] as T;
  }

  if (data && typeof data === "object") {
    return data as T;
  }

  throw new Error(`La funcion ${functionName} devolvio una respuesta invalida.`);
}

function normalizeCodeOrToken(codeOrToken: string) {
  // Acepta codigo manual o token QR aun con espacios/separadores pegados.
  return codeOrToken.trim().replace(/[^0-9a-zA-Z]/g, "");
}

export interface IssuedMobileAccessCode {
  accessCodeId: string;
  code: string;
  qrToken: string;
  expiresAt: string;
}

type IssueMobileAccessCodeRow = {
  access_code_id: string;
  code: string;
  qr_token: string;
  expires_at: string;
};

export async function issueMobileAccessCode(ttlMinutes: number): Promise<IssuedMobileAccessCode> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("issue_mobile_access_code", {
    p_ttl_minutes: ttlMinutes,
  });

  if (error) {
    throw new Error(getErrorMessage(error, "No se pudo generar el codigo."));
  }
  const row = getSingleRpcRow<IssueMobileAccessCodeRow>(
    data as RpcRow<IssueMobileAccessCodeRow>,
    "issue_mobile_access_code"
  );

  return {
    accessCodeId: row.access_code_id,
    code: row.code,
    qrToken: row.qr_token,
    expiresAt: row.expires_at,
  };
}

export interface MobileSessionPayload {
  sessionId: string;
  accessCodeId: string;
  scope: string;
  expiresAt: string;
  operatorName?: string | null;
}

type ConsumeMobileAccessCodeRow = {
  session_id: string;
  access_code_id: string;
  scope: string;
  expires_at: string;
};

export async function consumeMobileAccessCode(
  codeOrToken: string,
  operatorName?: string
): Promise<MobileSessionPayload> {
  const normalizedCodeOrToken = normalizeCodeOrToken(codeOrToken);
  if (!normalizedCodeOrToken) {
    throw new Error("Ingresa un codigo o token valido.");
  }

  const supabase = createClient();
  const { data, error } = await withTimeout<RpcResponse<ConsumeMobileAccessCodeRow>>(
    supabase.rpc("consume_mobile_access_code", {
      p_code_or_token: normalizedCodeOrToken,
      p_operator_name: operatorName?.trim() || null,
    }) as Promise<RpcResponse<ConsumeMobileAccessCodeRow>>,
    12000,
    "No hubo respuesta del servidor. Revisa internet en el telefono y desactiva VPN/Private DNS/adblock que bloquee supabase.co."
  );

  if (error) {
    throw new Error(getErrorMessage(error, "No se pudo abrir la sesion movil."));
  }
  const row = getSingleRpcRow<ConsumeMobileAccessCodeRow>(
    data as RpcRow<ConsumeMobileAccessCodeRow>,
    "consume_mobile_access_code"
  );

  return {
    sessionId: row.session_id,
    accessCodeId: row.access_code_id,
    scope: row.scope,
    expiresAt: row.expires_at,
    operatorName: operatorName?.trim() || null,
  };
}

export async function touchMobileSession(sessionId: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("touch_mobile_session", {
    p_session_id: sessionId,
  });

  if (error) {
    throw new Error(getErrorMessage(error, "No se pudo validar la sesion."));
  }
  return Boolean(data);
}

export async function revokeMobileSession(sessionId: string): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("revoke_mobile_session", {
    p_session_id: sessionId,
  });

  if (error) {
    throw new Error(getErrorMessage(error, "No se pudo revocar la sesion."));
  }
  return Boolean(data);
}

export interface ApplyStockCountAdjustmentInput {
  productId: string;
  countedStock: number;
  expectedRevision: number;
  reason?: string;
  source?: "mobile_count" | "desktop_manual" | "audit_round";
  sessionId?: string | null;
}

export interface ApplyStockCountAdjustmentResult {
  status: "ok" | "conflict";
  productId: string;
  stockBefore: number;
  stockAfter: number;
  delta: number;
  expectedRevision: number;
  actualRevision: number;
  newRevision: number;
  adjustmentId: string | null;
}

type ApplyStockCountAdjustmentRow = {
  status: "ok" | "conflict";
  product_id: string;
  stock_before: number;
  stock_after: number;
  delta: number;
  expected_revision: number;
  actual_revision: number;
  new_revision: number;
  adjustment_id: string | null;
};

export async function applyStockCountAdjustment(
  input: ApplyStockCountAdjustmentInput
): Promise<ApplyStockCountAdjustmentResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("apply_stock_count_adjustment", {
    p_product_id: input.productId,
    p_counted_stock: Number(input.countedStock),
    p_expected_revision: Number(input.expectedRevision),
    p_reason: input.reason || "physical_count",
    p_source: input.source || "mobile_count",
    p_session_id: input.sessionId || null,
  });

  if (error) {
    throw new Error(getErrorMessage(error, "No se pudo aplicar el ajuste."));
  }

  const row = getSingleRpcRow<ApplyStockCountAdjustmentRow>(
    data as RpcRow<ApplyStockCountAdjustmentRow>,
    "apply_stock_count_adjustment"
  );

  return {
    status: row.status,
    productId: row.product_id,
    stockBefore: Number(row.stock_before),
    stockAfter: Number(row.stock_after),
    delta: Number(row.delta),
    expectedRevision: Number(row.expected_revision),
    actualRevision: Number(row.actual_revision),
    newRevision: Number(row.new_revision),
    adjustmentId: row.adjustment_id,
  };
}

export interface StockMobileProduct {
  id: string;
  name: string;
  barcode: string;
  sku: string | null;
  stock: number;
  stockRevision: number;
  owner: {
    id: string;
    name: string;
    displayName: string;
    color: string;
  };
}

type StockMobileProductRow = {
  id: string;
  name: string;
  barcode: string;
  sku: string | null;
  stock: number;
  stock_revision: number;
  owner:
    | {
        id: string;
        name: string;
        display_name: string;
        color_hex: string;
      }
    | null;
};

function mapStockMobileProduct(row: StockMobileProductRow): StockMobileProduct {
  const ownerConfig = getPartnerConfigFromPartner(
    row.owner
      ? {
          name: row.owner.name,
          display_name: row.owner.display_name,
          color_hex: row.owner.color_hex,
        }
      : null
  );

  return {
    id: row.id,
    name: row.name,
    barcode: row.barcode,
    sku: row.sku,
    stock: Number(row.stock),
    stockRevision: Number(row.stock_revision),
    owner: {
      id: row.owner?.id || "",
      name: row.owner?.name || "todos",
      displayName: ownerConfig.displayName,
      color: ownerConfig.color,
    },
  };
}

type FindStockMobileProductRow = {
  product_id: string;
  product_name: string;
  product_barcode: string;
  product_sku: string | null;
  stock: number;
  stock_revision: number;
  owner_id: string;
  owner_name: string;
  owner_display_name: string | null;
  owner_color_hex: string | null;
};

function getRpcRows<T>(data: RpcRow<T>): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") return [data as T];
  return [];
}

export async function findStockMobileProductByCode(
  codeOrName: string,
  sessionId: string
): Promise<StockMobileProduct | null> {
  const normalizedQuery = codeOrName.trim();
  if (!normalizedQuery) return null;
  if (!sessionId?.trim()) {
    throw new Error("Sesion movil invalida.");
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("find_stock_mobile_product", {
    p_query: normalizedQuery,
    p_session_id: sessionId.trim(),
  });

  if (error) {
    throw new Error(getErrorMessage(error, "No se pudo buscar el producto."));
  }

  const rows = getRpcRows<FindStockMobileProductRow>(data as RpcRow<FindStockMobileProductRow>);
  if (rows.length === 0) return null;

  const row = rows[0];
  return mapStockMobileProduct({
    id: row.product_id,
    name: row.product_name,
    barcode: row.product_barcode,
    sku: row.product_sku,
    stock: row.stock,
    stock_revision: row.stock_revision,
    owner: {
      id: row.owner_id,
      name: row.owner_name,
      display_name: row.owner_display_name || row.owner_name,
      color_hex: row.owner_color_hex || "#475569",
    },
  });
}

export interface ActiveMobileSessionView {
  id: string;
  accessCodeId: string;
  accessCode: string;
  operatorName: string | null;
  scope: string;
  expiresAt: string;
  lastSeenAt: string;
  createdAt: string;
}

type MobileSessionRow = {
  id: string;
  access_code_id: string;
  operator_name: string | null;
  scope: string;
  expires_at: string;
  last_seen_at: string;
  created_at: string;
};

type MobileAccessCodeLookupRow = {
  id: string;
  code: string;
};

export async function listActiveMobileSessions(limit = 20): Promise<ActiveMobileSessionView[]> {
  const supabase = createClient();
  const nowIso = new Date().toISOString();

  const { data: sessions, error: sessionsError } = await supabase
    .from("mobile_sessions")
    .select("id, access_code_id, operator_name, scope, expires_at, last_seen_at, created_at")
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sessionsError) {
    throw new Error(getErrorMessage(sessionsError, "No se pudo listar sesiones moviles."));
  }

  const rows = (sessions || []) as MobileSessionRow[];
  if (rows.length === 0) return [];

  const uniqueCodeIds = Array.from(new Set(rows.map((row) => row.access_code_id))).filter(Boolean);
  const { data: codes, error: codesError } = await supabase
    .from("mobile_access_codes")
    .select("id, code")
    .in("id", uniqueCodeIds);

  if (codesError) {
    throw new Error(getErrorMessage(codesError, "No se pudo resolver codigos moviles."));
  }

  const codeById = new Map<string, string>();
  ((codes || []) as MobileAccessCodeLookupRow[]).forEach((codeRow) => {
    codeById.set(codeRow.id, codeRow.code);
  });

  return rows.map((row) => ({
    id: row.id,
    accessCodeId: row.access_code_id,
    accessCode: codeById.get(row.access_code_id) || "-",
    operatorName: row.operator_name,
    scope: row.scope,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  }));
}

export interface RecentStockAdjustmentView {
  id: string;
  createdAt: string;
  source: string;
  reason: string;
  stockBefore: number;
  stockCounted: number;
  delta: number;
  reviewStatus: string;
  productName: string;
  productBarcode: string;
  operatorName: string | null;
}

type StockAdjustmentRow = {
  id: string;
  product_id: string;
  performed_by_session_id: string | null;
  source: string;
  reason: string;
  stock_before: number;
  stock_counted: number;
  delta: number;
  review_status: string;
  created_at: string;
};

type ProductLookupRow = {
  id: string;
  name: string;
  barcode: string;
};

type MobileSessionLookupRow = {
  id: string;
  operator_name: string | null;
};

export async function listRecentStockAdjustments(limit = 30): Promise<RecentStockAdjustmentView[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("stock_adjustments")
    .select(
      "id, product_id, performed_by_session_id, source, reason, stock_before, stock_counted, delta, review_status, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  const adjustments = (data || []) as StockAdjustmentRow[];
  if (adjustments.length === 0) return [];

  const productIds = Array.from(new Set(adjustments.map((row) => row.product_id))).filter(Boolean);
  const sessionIds = Array.from(
    new Set(adjustments.map((row) => row.performed_by_session_id).filter((id): id is string => Boolean(id)))
  );

  const [productsResult, sessionsResult] = await Promise.all([
    supabase.from("products").select("id, name, barcode").in("id", productIds),
    sessionIds.length
      ? supabase.from("mobile_sessions").select("id, operator_name").in("id", sessionIds)
      : Promise.resolve({ data: [], error: null as null }),
  ]);

  if (productsResult.error) throw productsResult.error;
  if (sessionsResult.error) throw sessionsResult.error;

  const productsById = new Map<string, ProductLookupRow>();
  ((productsResult.data || []) as ProductLookupRow[]).forEach((row) => {
    productsById.set(row.id, row);
  });

  const sessionsById = new Map<string, MobileSessionLookupRow>();
  ((sessionsResult.data || []) as MobileSessionLookupRow[]).forEach((row) => {
    sessionsById.set(row.id, row);
  });

  return adjustments.map((row) => {
    const product = productsById.get(row.product_id);
    const session = row.performed_by_session_id
      ? sessionsById.get(row.performed_by_session_id)
      : null;

    return {
      id: row.id,
      createdAt: row.created_at,
      source: row.source,
      reason: row.reason,
      stockBefore: Number(row.stock_before),
      stockCounted: Number(row.stock_counted),
      delta: Number(row.delta),
      reviewStatus: row.review_status,
      productName: product?.name || "Producto",
      productBarcode: product?.barcode || "-",
      operatorName: session?.operator_name || null,
    };
  });
}

export function loadStoredStockMobileSession(): MobileSessionPayload | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STOCK_MOBILE_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as MobileSessionPayload;
    if (!parsed?.sessionId || !parsed?.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredStockMobileSession(session: MobileSessionPayload) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STOCK_MOBILE_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredStockMobileSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STOCK_MOBILE_SESSION_STORAGE_KEY);
}

export function isStockMobileSessionExpired(expiresAt: string): boolean {
  return Number(new Date(expiresAt).getTime()) <= Date.now();
}
