/**
 * @file database.ts
 * @description Tipos TypeScript que reflejan el schema de Supabase.
 *              Mantener sincronizado con supabase/schema.sql
 *
 * En producción, estos tipos se generarian con:
 *   npx supabase gen types typescript --project-id <id> > src/types/database.ts
 *
 * Por ahora los definimos manualmente para desarrollo ágil.
 */

// ============================================
// ENUMS
// ============================================

export type PartnerEnum = string;
export type TransactionType = "sale" | "expense";
export type ExpenseScope = "individual" | "shared";
export type CashSessionStatus = "open" | "closed";
export type PaymentMethod = "cash" | "transfer";
export type InventoryMovementReason =
  | "sale"
  | "manual_adjustment"
  | "initial_stock"
  | "restock"
  | "return"
  | "old_stock";

// ============================================
// TABLAS
// ============================================

/** Socia del negocio */
export interface Partner {
  id: string;
  name: PartnerEnum;
  display_name: string;
  color_hex: string;
  is_expense_eligible: boolean;
  created_at: string;
}

/** Producto en inventario */
export interface Product {
  id: string;
  barcode: string;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  owner_id: string;
  purchase_price: number;
  sale_price: number;
  stock: number;
  min_stock: number;
  image_url: string | null;
  is_active: boolean;
  is_clearance: boolean;
  clearance_price: number | null;
  bodega_at: string | null;
  disposed_at: string | null;
  bodega_stock: number;
  created_at: string;
  updated_at: string;
}

/** Producto con datos de la socia (JOIN) */
export interface ProductWithOwner extends Product {
  owner: Partner;
}

/** Sesión de caja */
export interface CashSession {
  id: string;
  opened_by: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  status: CashSessionStatus;
  notes: string | null;
}

/** Cabecera de venta */
export interface Sale {
  id: string;
  cash_session_id: string;
  sold_by: string | null;
  total: number;
  payment_method: PaymentMethod;
  notes: string | null;
  amount_received: number | null;
  change_given: number | null;
  idempotency_key: string | null;
  created_at: string;
  synced: boolean;
}

/** Línea de detalle de venta */
export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  product_barcode: string;
  owner_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  created_at: string;
}

/** Gasto */
export interface Expense {
  id: string;
  cash_session_id: string;
  amount: number;
  description: string;
  scope: ExpenseScope;
  idempotency_key: string | null;
  registered_by: string | null;
  created_at: string;
  synced: boolean;
}

/** Asignación de gasto a socia */
export interface ExpenseAllocation {
  id: string;
  expense_id: string;
  partner_id: string;
  amount: number;
}

/** Movimiento de inventario */
export interface InventoryMovement {
  id: string;
  product_id: string;
  quantity_change: number;
  reason: InventoryMovementReason;
  reference_id: string | null;
  performed_by: string | null;
  created_at: string;
}

/** Movimiento de inventario con datos del producto (JOIN) */
export interface InventoryMovementWithProduct extends InventoryMovement {
  product: {
    id: string;
    name: string;
    barcode: string;
    owner: Partner | null;
  } | null;
}

/** Vista de reporte de cierre de caja */
export interface CashSessionReport {
  session_id: string;
  opened_at: string;
  closed_at: string | null;
  partner: PartnerEnum;
  display_name: string;
  color_hex: string;
  total_sales: number;
  total_expenses: number;
  net_total: number;
}

// ============================================
// TIPOS DE CARRITO (Estado local)
// ============================================

/** Item en el carrito de venta */
export interface CartItem {
  product_id: string;
  barcode: string;
  name: string;
  owner_id: string;
  owner_name: PartnerEnum;
  owner_display_name: string;
  owner_color: string;
  available_stock: number;
  unit_price: number;
  price_override: number;
  quantity: number;
  subtotal: number;
}

export interface CartMutationResult {
  ok: boolean;
  reason?: "out_of_stock" | "quantity_limit" | "not_found";
  availableStock?: number;
}

/** Resumen de ventas agrupadas por socia */
export interface PartnerSaleSummary {
  partner_id: string;
  partner_name: PartnerEnum;
  display_name: string;
  color_hex: string;
  total: number;
  item_count: number;
}
