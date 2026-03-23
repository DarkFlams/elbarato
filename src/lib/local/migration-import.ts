"use client";

import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";
import type { Partner, ProductWithOwner } from "@/types/database";
import { getCatalogPartners, saveCatalogProduct } from "./catalog";

export interface MigrationExistingProduct {
  id: string;
  barcode: string;
  sku?: string | null;
}

interface LocalProductKeyRecord {
  id: string;
  remote_id?: string | null;
  barcode: string;
  sku?: string | null;
}

function normalizeInventoryInteger(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

function mapRemoteProductForLocal(product: ProductWithOwner) {
  return {
    ...product,
    id: product.id,
    remote_id: product.id,
    owner_id: product.owner_id,
  };
}

async function fetchAllRemoteProducts() {
  const supabase = createClient();
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;
  const allProducts: ProductWithOwner[] = [];

  while (hasMore) {
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
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const batch = (data as ProductWithOwner[]) || [];
    allProducts.push(...batch);
    hasMore = batch.length === pageSize;
    from += pageSize;
  }

  return allProducts;
}

async function hydrateAllProductsIntoLocal() {
  const allProducts = await fetchAllRemoteProducts();
  await invoke<number>("upsert_remote_products", {
    products: allProducts.map(mapRemoteProductForLocal),
  });
  return allProducts;
}

export async function getMigrationPartnersLocalFirst(): Promise<Partner[]> {
  return getCatalogPartners();
}

export async function getMigrationExistingProductsLocalFirst(): Promise<MigrationExistingProduct[]> {
  if (!isTauriRuntime()) {
    const allProducts = await fetchAllRemoteProducts();
    return allProducts.map((product) => ({
      id: product.id,
      barcode: product.barcode,
      sku: product.sku ?? null,
    }));
  }

  try {
    let products = await invoke<LocalProductKeyRecord[]>("list_local_product_keys");
    if (products.length === 0) {
      await hydrateAllProductsIntoLocal();
      products = await invoke<LocalProductKeyRecord[]>("list_local_product_keys");
    }

    return products.map((product) => ({
      id: product.remote_id || product.id,
      barcode: product.barcode,
      sku: product.sku ?? null,
    }));
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;

    const allProducts = await fetchAllRemoteProducts();
    return allProducts.map((product) => ({
      id: product.id,
      barcode: product.barcode,
      sku: product.sku ?? null,
    }));
  }
}

export async function importMigrationProductLocalFirst(input: {
  productId?: string | null;
  barcode: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  ownerId: string;
  salePrice: number;
  stock: number;
  minStock: number;
}) {
  const normalizedStock = normalizeInventoryInteger(input.stock);
  const normalizedMinStock = normalizeInventoryInteger(input.minStock);

  return saveCatalogProduct({
    productId: input.productId ?? null,
    remoteId: input.productId ?? null,
    barcode: input.barcode,
    sku: input.sku ?? null,
    name: input.name,
    description: input.description ?? null,
    category: null,
    ownerId: input.ownerId,
    purchasePrice: 0,
    salePrice: input.salePrice,
    stock: normalizedStock,
    minStock: normalizedMinStock,
    isActive: true,
  });
}
