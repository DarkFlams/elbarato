"use client";

import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";
import type { Partner, ProductWithOwner } from "@/types/database";
import { getCatalogPartners, getCatalogProducts, saveCatalogProduct } from "./catalog";

export interface MigrationExistingProduct {
  id: string;
  barcode: string;
  sku?: string | null;
}

export interface MigrationCatalogProductSnapshot {
  id: string;
  barcode: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  ownerId: string;
  purchasePrice: number;
  salePrice: number;
  salePriceX3: number | null;
  salePriceX6: number | null;
  salePriceX12: number | null;
  stock: number;
  minStock: number;
  isActive: boolean;
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

async function upsertMigrationProductRemote(input: {
  productId?: string | null;
  barcode: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  ownerId: string;
  purchasePrice: number;
  salePrice: number;
  salePriceX3?: number | null;
  salePriceX6?: number | null;
  salePriceX12?: number | null;
  stock: number;
  minStock: number;
  isActive: boolean;
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("upsert_product_with_movement", {
    p_product_id: input.productId ?? null,
    p_barcode: input.barcode,
    p_name: input.name.trim(),
    p_description: input.description ?? null,
    p_category: null,
    p_owner_id: input.ownerId,
    p_purchase_price: input.purchasePrice,
    p_sale_price: input.salePrice,
    p_stock: input.stock,
    p_min_stock: input.minStock,
    p_is_active: input.isActive,
    p_sku: input.sku ?? null,
    p_sale_price_x3: input.salePriceX3 ?? null,
    p_sale_price_x6: input.salePriceX6 ?? null,
    p_sale_price_x12: input.salePriceX12 ?? null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
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

export async function getMigrationCatalogProductsLocalFirst(): Promise<
  MigrationCatalogProductSnapshot[]
> {
  const pageSize = 500;
  let offset = 0;
  let hasMore = true;
  const products: MigrationCatalogProductSnapshot[] = [];

  while (hasMore) {
    const batch = await getCatalogProducts({
      limit: pageSize,
      offset,
      stockFilter: "all",
    });

    products.push(
      ...batch.map((product) => ({
        id: product.id,
        barcode: product.barcode,
        sku: product.sku ?? null,
        name: product.name,
        description: product.description ?? null,
        ownerId: product.owner_id,
        purchasePrice: Number(product.purchase_price || 0),
        salePrice: Number(product.sale_price || 0),
        salePriceX3:
          product.sale_price_x3 === null ? null : Number(product.sale_price_x3 || 0),
        salePriceX6:
          product.sale_price_x6 === null ? null : Number(product.sale_price_x6 || 0),
        salePriceX12:
          product.sale_price_x12 === null ? null : Number(product.sale_price_x12 || 0),
        stock: normalizeInventoryInteger(Number(product.stock || 0)),
        minStock: normalizeInventoryInteger(Number(product.min_stock || 0)),
        isActive: Boolean(product.is_active),
      }))
    );

    hasMore = batch.length === pageSize;
    offset += pageSize;
  }

  return products;
}

export async function importMigrationProductLocalFirst(input: {
  productId?: string | null;
  barcode: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  ownerId: string;
  salePrice: number;
  salePriceX3?: number | null;
  salePriceX6?: number | null;
  salePriceX12?: number | null;
  stock: number;
  minStock: number;
}) {
  const normalizedStock = normalizeInventoryInteger(input.stock);
  const normalizedMinStock = normalizeInventoryInteger(input.minStock);

  const payload = {
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
    salePriceX3: input.salePriceX3 ?? null,
    salePriceX6: input.salePriceX6 ?? null,
    salePriceX12: input.salePriceX12 ?? null,
    stock: normalizedStock,
    minStock: normalizedMinStock,
    isActive: true,
  };

  return saveCatalogProduct(payload).catch(async (localError) => {
    console.warn(
      "[migration-import] local inventory import failed, using remote fallback",
      localError
    );
    return upsertMigrationProductRemote({
      productId: payload.productId,
      barcode: payload.barcode,
      sku: payload.sku,
      name: payload.name,
      description: payload.description,
      ownerId: payload.ownerId,
      purchasePrice: payload.purchasePrice,
      salePrice: payload.salePrice,
      salePriceX3: payload.salePriceX3,
      salePriceX6: payload.salePriceX6,
      salePriceX12: payload.salePriceX12,
      stock: payload.stock,
      minStock: payload.minStock,
      isActive: payload.isActive,
    });
  });
}

export async function updateMigrationProductPricesLocalFirst(input: {
  productId: string;
  barcode: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  ownerId: string;
  purchasePrice: number;
  salePrice: number;
  salePriceX3?: number | null;
  salePriceX6?: number | null;
  salePriceX12?: number | null;
  stock: number;
  minStock: number;
  isActive: boolean;
}) {
  const normalizedStock = normalizeInventoryInteger(input.stock);
  const normalizedMinStock = normalizeInventoryInteger(input.minStock);

  const payload = {
    productId: input.productId,
    remoteId: input.productId,
    barcode: input.barcode,
    sku: input.sku ?? null,
    name: input.name,
    description: input.description ?? null,
    category: null,
    ownerId: input.ownerId,
    purchasePrice: Number(input.purchasePrice || 0),
    salePrice: input.salePrice,
    salePriceX3: input.salePriceX3 ?? null,
    salePriceX6: input.salePriceX6 ?? null,
    salePriceX12: input.salePriceX12 ?? null,
    stock: normalizedStock,
    minStock: normalizedMinStock,
    isActive: input.isActive,
  };

  return saveCatalogProduct(payload).catch(async (localError) => {
    console.warn(
      "[migration-import] local price update failed, using remote fallback",
      localError
    );
    return upsertMigrationProductRemote({
      productId: payload.productId,
      barcode: payload.barcode,
      sku: payload.sku,
      name: payload.name,
      description: payload.description,
      ownerId: payload.ownerId,
      purchasePrice: payload.purchasePrice,
      salePrice: payload.salePrice,
      salePriceX3: payload.salePriceX3,
      salePriceX6: payload.salePriceX6,
      salePriceX12: payload.salePriceX12,
      stock: payload.stock,
      minStock: payload.minStock,
      isActive: payload.isActive,
    });
  });
}
