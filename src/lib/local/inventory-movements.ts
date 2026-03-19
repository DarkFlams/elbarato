"use client";

import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";
import type { InventoryMovementWithProduct, Partner, ProductWithOwner } from "@/types/database";
import { findCatalogProductByBarcode, getCatalogProducts } from "./catalog";

interface LocalPartnerRecord extends Partner {
  remote_id?: string | null;
}

interface AdjustmentSearchProduct {
  id: string;
  name: string;
  barcode: string;
  sku: string | null;
  stock: number;
  min_stock: number;
  owner: LocalPartnerRecord | null;
}

interface AdjustLocalResult {
  productId: string;
  newStock: number;
  movementDelta: number;
}

interface LocalInventoryMovement {
  id: string;
  product_id: string;
  quantity_change: number;
  reason: string;
  reference_id: string | null;
  performed_by: string | null;
  created_at: string;
  product: {
    id: string;
    name: string;
    barcode: string;
    owner: LocalPartnerRecord | null;
  } | null;
}

export async function searchAdjustmentProductsLocalFirst(query: string) {
  const products = await getCatalogProducts({ search: query, limit: 10, offset: 0 });
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    barcode: product.barcode,
    sku: product.sku,
    stock: product.stock,
    min_stock: product.min_stock,
    owner: product.owner,
  })) as AdjustmentSearchProduct[];
}

export async function findAdjustmentProductByCodeLocalFirst(code: string) {
  const product = await findCatalogProductByBarcode(code);
  if (!product) return null;

  return {
    id: product.id,
    name: product.name,
    barcode: product.barcode,
    sku: product.sku,
    stock: product.stock,
    min_stock: product.min_stock,
    owner: product.owner,
  } as AdjustmentSearchProduct;
}

export async function adjustProductStockLocalFirst(input: {
  productId: string;
  quantity: number;
  operation: "in" | "out";
  reason: string;
}) {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("adjust_product_stock", {
      p_product_id: input.productId,
      p_quantity: input.quantity,
      p_operation: input.operation,
      p_reason: input.reason,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      productId: row?.product_id ?? input.productId,
      newStock: Number(row?.new_stock ?? 0),
      movementDelta: Number(row?.movement_delta ?? 0),
    } as AdjustLocalResult;
  }

  try {
    return await invoke<AdjustLocalResult>("adjust_local_product_stock", {
      productId: input.productId,
      quantity: input.quantity,
      operation: input.operation,
      reason: input.reason,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;

    const supabase = createClient();
    const { data, error: remoteError } = await supabase.rpc("adjust_product_stock", {
      p_product_id: input.productId,
      p_quantity: input.quantity,
      p_operation: input.operation,
      p_reason: input.reason,
    });
    if (remoteError) throw remoteError;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      productId: row?.product_id ?? input.productId,
      newStock: Number(row?.new_stock ?? 0),
      movementDelta: Number(row?.movement_delta ?? 0),
    } as AdjustLocalResult;
  }
}

export async function listInventoryMovementsLocalFirst() {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("inventory_movements")
      .select(
        `
        *,
        product:products!inventory_movements_product_id_fkey (
          id,
          name,
          barcode,
          owner:partners!products_owner_id_fkey (
            id, name, display_name, color_hex, created_at, is_expense_eligible
          )
        )
      `
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data as InventoryMovementWithProduct[]) || [];
  }

  try {
    const data = await invoke<LocalInventoryMovement[]>("list_local_inventory_movements", {
      limit: 200,
    });

    return data.map((movement) => ({
      id: movement.id,
      product_id: movement.product_id,
      quantity_change: movement.quantity_change,
      reason: movement.reason as InventoryMovementWithProduct["reason"],
      reference_id: movement.reference_id,
      performed_by: movement.performed_by,
      created_at: movement.created_at,
      product: movement.product
        ? {
            id: movement.product.id,
            name: movement.product.name,
            barcode: movement.product.barcode,
            owner: movement.product.owner
              ? {
                  id: movement.product.owner.remote_id || movement.product.owner.id,
                  name: movement.product.owner.name,
                  display_name: movement.product.owner.display_name,
                  color_hex: movement.product.owner.color_hex,
                  created_at: movement.product.owner.created_at || movement.created_at,
                  is_expense_eligible: movement.product.owner.is_expense_eligible,
                }
              : null,
          }
        : null,
    })) as InventoryMovementWithProduct[];
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;

    const supabase = createClient();
    const { data, error: remoteError } = await supabase
      .from("inventory_movements")
      .select(
        `
        *,
        product:products!inventory_movements_product_id_fkey (
          id,
          name,
          barcode,
          owner:partners!products_owner_id_fkey (
            id, name, display_name, color_hex, created_at, is_expense_eligible
          )
        )
      `
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (remoteError) throw remoteError;
    return (data as InventoryMovementWithProduct[]) || [];
  }
}
