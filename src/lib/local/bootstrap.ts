"use client";

import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";
import type { Partner, ProductWithOwner } from "@/types/database";

interface LocalAppSettingRecord {
  key: string;
  value: string;
}

interface LocalProductKeyRecord {
  id: string;
  remote_id?: string | null;
  barcode: string;
}

interface BootstrapProgress {
  stage: "partners" | "products";
  processed: number;
  total: number;
}

export interface LocalCatalogBootstrapResult {
  ready: boolean;
  seeded: boolean;
  requiresInternet: boolean;
  productCount: number;
}

function mapRemoteProductForLocal(product: ProductWithOwner) {
  return {
    id: product.id,
    remote_id: product.id,
    barcode: product.barcode,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    owner_id: product.owner_id,
    purchase_price: product.purchase_price,
    sale_price: product.sale_price,
    stock: product.stock,
    min_stock: product.min_stock,
    image_url: product.image_url,
    is_active: product.is_active,
    is_clearance: product.is_clearance,
    clearance_price: product.clearance_price,
    bodega_at: product.bodega_at,
    disposed_at: product.disposed_at,
    bodega_stock: product.bodega_stock,
    created_at: product.created_at,
    updated_at: product.updated_at,
  };
}

function mapRemotePartnerForLocal(partner: Partner) {
  return {
    ...partner,
    remote_id: partner.id,
  };
}

async function getLocalAppSetting(key: string) {
  if (!isTauriRuntime()) return null;

  try {
    return await invoke<LocalAppSettingRecord | null>("get_local_app_setting", { key });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return null;
  }
}

async function setLocalAppSetting(key: string, value: string) {
  if (!isTauriRuntime()) return false;

  try {
    return await invoke<boolean>("set_local_app_setting", { key, value });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return false;
  }
}

async function getLocalProductKeys() {
  if (!isTauriRuntime()) return [] as LocalProductKeyRecord[];

  try {
    return await invoke<LocalProductKeyRecord[]>("list_local_product_keys");
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return [];
  }
}

async function fetchAllRemotePartners() {
  const supabase = createClient();
  const { data, error } = await supabase.from("partners").select("*").order("name");
  if (error) throw error;
  return (data as Partner[]) || [];
}

async function fetchRemoteProductsPage(from: number, to: number) {
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
    .order("updated_at", { ascending: true })
    .range(from, to);

  if (error) throw error;
  return (data as ProductWithOwner[]) || [];
}

async function fetchRemoteProductsCount() {
  const supabase = createClient();
  const { count, error } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true });

  if (error) throw error;
  return count ?? 0;
}

export async function getLocalCatalogBootstrapState(): Promise<LocalCatalogBootstrapResult> {
  if (!isTauriRuntime()) {
    return {
      ready: true,
      seeded: true,
      requiresInternet: false,
      productCount: 0,
    };
  }

  const [seededSetting, productKeys] = await Promise.all([
    getLocalAppSetting("catalog_seeded"),
    getLocalProductKeys(),
  ]);

  const seeded = seededSetting?.value === "1";
  return {
    ready: seeded && productKeys.length > 0,
    seeded,
    requiresInternet: false,
    productCount: productKeys.length,
  };
}

export async function ensureInitialLocalCatalog(
  onProgress?: (progress: BootstrapProgress) => void
): Promise<LocalCatalogBootstrapResult> {
  if (!isTauriRuntime()) {
    return {
      ready: true,
      seeded: true,
      requiresInternet: false,
      productCount: 0,
    };
  }

  const currentState = await getLocalCatalogBootstrapState();
  if (currentState.ready) {
    return currentState;
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      ready: false,
      seeded: currentState.seeded,
      requiresInternet: true,
      productCount: currentState.productCount,
    };
  }

  await setLocalAppSetting("catalog_seeded", "0");

  const partners = await fetchAllRemotePartners();
  onProgress?.({
    stage: "partners",
    processed: partners.length,
    total: partners.length,
  });
  await invoke<number>("upsert_remote_partners", {
    partners: partners.map(mapRemotePartnerForLocal),
  });

  const totalProducts = await fetchRemoteProductsCount();
  const pageSize = 500;
  let processed = 0;

  for (let from = 0; from < totalProducts; from += pageSize) {
    const batch = await fetchRemoteProductsPage(from, from + pageSize - 1);
    if (batch.length === 0) break;

    await invoke<number>("upsert_remote_products", {
      products: batch.map(mapRemoteProductForLocal),
    });

    processed += batch.length;
    onProgress?.({
      stage: "products",
      processed,
      total: totalProducts,
    });
  }

  await Promise.all([
    setLocalAppSetting("catalog_seeded", "1"),
    setLocalAppSetting("catalog_seeded_at", new Date().toISOString()),
    setLocalAppSetting("catalog_seed_count", String(processed)),
  ]);

  return {
    ready: true,
    seeded: true,
    requiresInternet: false,
    productCount: processed,
  };
}
