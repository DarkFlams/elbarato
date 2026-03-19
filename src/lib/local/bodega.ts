"use client";

import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";
import type { ProductWithOwner } from "@/types/database";

interface LocalPartnerRecord {
  id: string;
  remote_id?: string | null;
  name: string;
  display_name: string;
  color_hex: string;
  is_expense_eligible?: boolean;
  created_at?: string | null;
}

interface LocalBodegaProductRecord {
  id: string;
  remote_id?: string | null;
  name: string;
  barcode: string;
  sku: string | null;
  sale_price: number;
  stock: number;
  bodega_stock: number;
  bodega_at: string | null;
  is_active: boolean;
  owner: LocalPartnerRecord | null;
}

interface CreateLocalRemateResult {
  productId: string;
  productName: string;
  originalPrice: number;
  rematePrice: number;
}

interface DisposeLocalProductResult {
  productId: string;
  productName: string;
}

function mapRemoteBodegaProducts(data: ProductWithOwner[]): LocalBodegaProductRecord[] {
  return data.map((product) => ({
    id: product.id,
    remote_id: product.id,
    name: product.name,
    barcode: product.barcode,
    sku: product.sku,
    sale_price: product.sale_price,
    stock: product.stock,
    bodega_stock: product.bodega_stock,
    bodega_at: product.bodega_at,
    is_active: product.is_active,
    owner: product.owner
      ? {
          ...product.owner,
          remote_id: product.owner.id,
        }
      : null,
  }));
}

async function hydrateBodegaFromSupabase() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      `
      *,
      owner:partners!products_owner_id_fkey (
        id, name, display_name, color_hex, is_expense_eligible, created_at
      )
    `
    )
    .gt("bodega_stock", 0)
    .is("disposed_at", null)
    .order("bodega_at", { ascending: true, nullsFirst: false });

  if (error) throw error;

  const products = (data as ProductWithOwner[]) || [];
  await invoke<number>("upsert_remote_products", {
    products: products.map((product) => ({
      ...product,
      remote_id: product.id,
      owner_id: product.owner_id,
    })),
  });

  return products;
}

export async function listBodegaProductsLocalFirst() {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("products")
      .select(
        `
        *,
        owner:partners!products_owner_id_fkey (
          id, name, display_name, color_hex, is_expense_eligible, created_at
        )
      `
      )
      .gt("bodega_stock", 0)
      .is("disposed_at", null)
      .order("bodega_at", { ascending: true, nullsFirst: false });

    if (error) throw error;
    return mapRemoteBodegaProducts((data as ProductWithOwner[]) || []);
  }

  try {
    let products = await invoke<LocalBodegaProductRecord[]>("list_local_bodega_products");
    if (products.length === 0) {
      await hydrateBodegaFromSupabase();
      products = await invoke<LocalBodegaProductRecord[]>("list_local_bodega_products");
    }
    return products;
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;

    const supabase = createClient();
    const { data, error: remoteError } = await supabase
      .from("products")
      .select(
        `
        *,
        owner:partners!products_owner_id_fkey (
          id, name, display_name, color_hex, is_expense_eligible, created_at
        )
      `
      )
      .gt("bodega_stock", 0)
      .is("disposed_at", null)
      .order("bodega_at", { ascending: true, nullsFirst: false });

    if (remoteError) throw remoteError;
    return mapRemoteBodegaProducts((data as ProductWithOwner[]) || []);
  }
}

export async function createRemateLocalFirst(input: {
  productId: string;
  clearancePrice: number;
  stock: number;
}) {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_remate", {
      p_product_id: input.productId,
      p_clearance_price: input.clearancePrice,
      p_stock: input.stock,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      productId: row?.product_id ?? input.productId,
      productName: row?.product_name ?? "",
      originalPrice: Number(row?.original_price ?? 0),
      rematePrice: Number(row?.remate_price ?? input.clearancePrice),
    } as CreateLocalRemateResult;
  }

  try {
    return await invoke<CreateLocalRemateResult>("create_local_remate", {
      productId: input.productId,
      clearancePrice: input.clearancePrice,
      stock: input.stock,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;

    const supabase = createClient();
    const { data, error: remoteError } = await supabase.rpc("create_remate", {
      p_product_id: input.productId,
      p_clearance_price: input.clearancePrice,
      p_stock: input.stock,
    });
    if (remoteError) throw remoteError;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      productId: row?.product_id ?? input.productId,
      productName: row?.product_name ?? "",
      originalPrice: Number(row?.original_price ?? 0),
      rematePrice: Number(row?.remate_price ?? input.clearancePrice),
    } as CreateLocalRemateResult;
  }
}

export async function disposeProductLocalFirst(productId: string) {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("dispose_product", {
      p_product_id: productId,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      productId: row?.product_id ?? productId,
      productName: row?.product_name ?? "",
    } as DisposeLocalProductResult;
  }

  try {
    return await invoke<DisposeLocalProductResult>("dispose_local_product", {
      productId,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;

    const supabase = createClient();
    const { data, error: remoteError } = await supabase.rpc("dispose_product", {
      p_product_id: productId,
    });
    if (remoteError) throw remoteError;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      productId: row?.product_id ?? productId,
      productName: row?.product_name ?? "",
    } as DisposeLocalProductResult;
  }
}
