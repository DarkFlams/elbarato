"use client";

import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";
import type { Partner, Product, ProductWithOwner } from "@/types/database";

interface LocalPartnerRecord extends Partner {
  remote_id?: string | null;
}

interface LocalProductRecord extends Product {
  remote_id?: string | null;
}

interface LocalProductWithOwnerRecord {
  product?: LocalProductRecord;
  owner?: LocalPartnerRecord | null;
  id?: string;
  remote_id?: string | null;
  barcode?: string;
  sku?: string | null;
  name?: string;
  description?: string | null;
  category?: string | null;
  owner_id?: string;
  purchase_price?: number;
  sale_price?: number;
  stock?: number;
  min_stock?: number;
  image_url?: string | null;
  is_active?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  is_clearance?: boolean;
  clearance_price?: number | null;
  bodega_at?: string | null;
  disposed_at?: string | null;
  bodega_stock?: number;
}

interface ProductQuery {
  search?: string | null;
  ownerId?: string | null;
  stockFilter?: "all" | "ok" | "low" | "out" | null;
  limit?: number;
  offset?: number;
}

interface ProductCounts {
  totalCount: number;
  outCount: number;
  lowCount: number;
  availableCount: number;
}

interface ProductCountRow {
  stock: number;
  min_stock: number;
}

interface UpsertLocalProductInput {
  productId?: string | null;
  remoteId?: string | null;
  barcode: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  ownerId: string;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  isActive: boolean;
}

interface UpsertLocalProductResult {
  productId: string;
  movementDelta: number;
}

function mapLocalProduct(record: LocalProductRecord, owner: LocalPartnerRecord): ProductWithOwner {
  return {
    ...record,
    id: record.remote_id || record.id,
    owner_id: owner.remote_id || owner.id,
    owner,
  };
}

function buildFallbackOwner(ownerId?: string | null): LocalPartnerRecord {
  const fallbackId = ownerId?.trim() || "unknown-owner";

  return {
    id: fallbackId,
    remote_id: null,
    name: "todos",
    display_name: "Sin socia",
    color_hex: "#64748B",
    is_expense_eligible: true,
    created_at: new Date(0).toISOString(),
  };
}

function normalizeLocalProductWithOwner(
  record: LocalProductWithOwnerRecord | null | undefined
): { product: LocalProductRecord; owner: LocalPartnerRecord } | null {
  if (!record || typeof record !== "object") return null;

  // Compatibilidad: en Rust viene product "flatten" o como campo product.
  const product = (record.product ?? record) as LocalProductRecord | undefined;
  if (!product || typeof product !== "object" || !product.id) return null;

  const owner = record.owner ?? buildFallbackOwner(product.owner_id);
  return { product, owner };
}

function mapRemoteProduct(data: ProductWithOwner[]): LocalProductRecord[] {
  return data.map((product) => ({
    ...product,
    id: product.id,
    remote_id: product.id,
    owner_id: product.owner_id,
    created_at: product.created_at,
    updated_at: product.updated_at,
  }));
}

function mapRemotePartner(data: Partner[]): LocalPartnerRecord[] {
  return data.map((partner) => ({
    ...partner,
    id: partner.id,
    remote_id: partner.id,
  }));
}

async function hydratePartnersFromSupabase() {
  const supabase = createClient();
  const { data, error } = await supabase.from("partners").select("*").order("name");

  if (error) throw error;

  const partners = (data as Partner[]) || [];
  await invoke<number>("upsert_remote_partners", {
    partners: mapRemotePartner(partners),
  });

  return partners;
}

async function hydrateProductsFromSupabase(filters?: ProductQuery) {
  const supabase = createClient();
  let query = supabase
    .from("products")
    .select(
      `
      *,
      owner:partners!products_owner_id_fkey (
        id, name, display_name, color_hex, is_expense_eligible, created_at
      )
    `
    )
    .eq("is_active", true);

  if (filters?.ownerId) {
    query = query.eq("owner_id", filters.ownerId);
  }

  if (filters?.search?.trim()) {
    const search = filters.search.trim().replace(/[,"]/g, " ");
    const term = `%${search}%`;
    query = query.or(`name.ilike.${term},barcode.ilike.${term},sku.ilike.${term}`);
  }

  const { data, error } = await query.order("name").limit(5000);

  if (error) throw error;

  const products = (data as ProductWithOwner[]) || [];
  await invoke<number>("upsert_remote_products", {
    products: mapRemoteProduct(products),
  });

  return products;
}

export async function getCatalogPartners() {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { data, error } = await supabase.from("partners").select("*").order("name");
    if (error) throw error;
    return (data as Partner[]) || [];
  }

  try {
    const localPartners = await invoke<LocalPartnerRecord[]>("list_local_partners");
    if (localPartners.length > 0) {
      return localPartners.map((partner) => ({
        ...partner,
        id: partner.remote_id || partner.id,
      }));
    }

    return hydratePartnersFromSupabase();
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[catalog] list_local_partners unavailable, using Supabase fallback");
    const supabase = createClient();
    const { data, error: remoteError } = await supabase.from("partners").select("*").order("name");
    if (remoteError) throw remoteError;
    return (data as Partner[]) || [];
  }
}

export async function getCatalogProducts(filters: ProductQuery = {}) {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    let query = supabase
      .from("products")
      .select(
        `
        *,
        owner:partners!products_owner_id_fkey (
          id, name, display_name, color_hex, is_expense_eligible, created_at
        )
      `
      )
      .eq("is_active", true);

    if (filters.ownerId) query = query.eq("owner_id", filters.ownerId);
    if (filters.search?.trim()) {
      const search = filters.search.trim().replace(/[,"]/g, " ");
      const term = `%${search}%`;
      query = query.or(`name.ilike.${term},barcode.ilike.${term},sku.ilike.${term}`);
    }

    const { data, error } = await query.order("name").range(filters.offset || 0, (filters.offset || 0) + ((filters.limit || 50) - 1));
    if (error) throw error;
    let products = (data as ProductWithOwner[]) || [];

    if (filters.stockFilter === "low") {
      products = products.filter((product) => product.stock > 0 && product.stock <= product.min_stock);
    } else if (filters.stockFilter === "ok") {
      products = products.filter((product) => product.stock > product.min_stock);
    } else if (filters.stockFilter === "out") {
      products = products.filter((product) => product.stock <= 0);
    }

    return products;
  }

  try {
    let products = await invoke<LocalProductWithOwnerRecord[]>("list_local_products", {
      filters: {
        search: filters.search ?? null,
        ownerId: filters.ownerId ?? null,
        stockFilter: filters.stockFilter ?? "all",
        limit: filters.limit ?? 50,
        offset: filters.offset ?? 0,
      },
    });

    if (products.length === 0 && (filters.offset ?? 0) === 0) {
      await hydrateProductsFromSupabase(filters);
      products = await invoke<LocalProductWithOwnerRecord[]>("list_local_products", {
        filters: {
          search: filters.search ?? null,
          ownerId: filters.ownerId ?? null,
          stockFilter: filters.stockFilter ?? "all",
          limit: filters.limit ?? 50,
          offset: filters.offset ?? 0,
        },
      });
    }

    const mapped = products
      .map((record) => normalizeLocalProductWithOwner(record))
      .filter((entry): entry is { product: LocalProductRecord; owner: LocalPartnerRecord } => Boolean(entry))
      .map(({ product, owner }) => mapLocalProduct(product, owner));

    if (mapped.length !== products.length) {
      console.warn(
        `[catalog] Se omitieron ${products.length - mapped.length} productos locales por datos incompletos`
      );
    }

    return mapped;
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[catalog] list_local_products unavailable, using Supabase fallback");
    const supabase = createClient();
    let query = supabase
      .from("products")
      .select(
        `
        *,
        owner:partners!products_owner_id_fkey (
          id, name, display_name, color_hex, is_expense_eligible, created_at
        )
      `
      )
      .eq("is_active", true);

    if (filters.ownerId) query = query.eq("owner_id", filters.ownerId);
    if (filters.search?.trim()) {
      const search = filters.search.trim().replace(/[,"]/g, " ");
      const term = `%${search}%`;
      query = query.or(`name.ilike.${term},barcode.ilike.${term},sku.ilike.${term}`);
    }

    const { data, error: remoteError } = await query
      .order("name")
      .range(filters.offset || 0, (filters.offset || 0) + ((filters.limit || 50) - 1));
    if (remoteError) throw remoteError;

    let products = (data as ProductWithOwner[]) || [];
    if (filters.stockFilter === "low") {
      products = products.filter((product) => product.stock > 0 && product.stock <= product.min_stock);
    } else if (filters.stockFilter === "ok") {
      products = products.filter((product) => product.stock > product.min_stock);
    } else if (filters.stockFilter === "out") {
      products = products.filter((product) => product.stock <= 0);
    }

    return products;
  }
}

export async function getCatalogProductCounts(filters: Pick<ProductQuery, "search" | "ownerId"> = {}) {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    let query = supabase
      .from("products")
      .select("stock, min_stock")
      .eq("is_active", true);

    if (filters.ownerId) query = query.eq("owner_id", filters.ownerId);
    if (filters.search?.trim()) {
      const term = `%${filters.search.trim().replace(/[,"]/g, " ")}%`;
      query = query.or(`name.ilike.${term},barcode.ilike.${term},sku.ilike.${term}`);
    }

    const { data, error } = await query.limit(5000);
    if (error) throw error;
    const products = (data || []) as ProductCountRow[];

    const totalCount = products.length;
    const outCount = products.filter((product) => Number(product.stock) <= 0).length;
    const lowCount = products.filter((product) => Number(product.stock) > 0 && Number(product.stock) <= Number(product.min_stock)).length;
    const availableCount = products.filter((product) => Number(product.stock) > Number(product.min_stock)).length;
    return {
      totalCount,
      outCount,
      lowCount,
      availableCount,
    };
  }

  try {
    return await invoke<ProductCounts>("count_local_products", {
      search: filters.search ?? null,
      ownerId: filters.ownerId ?? null,
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[catalog] count_local_products unavailable, using Supabase fallback");
    const supabase = createClient();
    let query = supabase
      .from("products")
      .select("stock, min_stock")
      .eq("is_active", true);

    if (filters.ownerId) query = query.eq("owner_id", filters.ownerId);
    if (filters.search?.trim()) {
      const term = `%${filters.search.trim().replace(/[,"]/g, " ")}%`;
      query = query.or(`name.ilike.${term},barcode.ilike.${term},sku.ilike.${term}`);
    }

    const { data, error: remoteError } = await query.limit(5000);
    if (remoteError) throw remoteError;
    const products = (data || []) as ProductCountRow[];

    const totalCount = products.length;
    const outCount = products.filter((product) => Number(product.stock) <= 0).length;
    const lowCount = products.filter((product) => Number(product.stock) > 0 && Number(product.stock) <= Number(product.min_stock)).length;
    const availableCount = products.filter((product) => Number(product.stock) > Number(product.min_stock)).length;
    return {
      totalCount,
      outCount,
      lowCount,
      availableCount,
    };
  }
}

export async function findCatalogProductByBarcode(barcode: string) {
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
      .or(`barcode.eq.${barcode},sku.eq.${barcode}`)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;
    return (data as ProductWithOwner | null) ?? null;
  }

  try {
    let localProduct = await invoke<LocalProductWithOwnerRecord | null>("find_local_product_by_barcode", {
      barcode,
    });

    if (!localProduct) {
      await hydrateProductsFromSupabase({ search: barcode });
      localProduct = await invoke<LocalProductWithOwnerRecord | null>("find_local_product_by_barcode", {
        barcode,
      });
    }

    const normalized = normalizeLocalProductWithOwner(localProduct);
    return normalized ? mapLocalProduct(normalized.product, normalized.owner) : null;
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[catalog] find_local_product_by_barcode unavailable, using Supabase fallback");
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
      .or(`barcode.eq.${barcode},sku.eq.${barcode}`)
      .eq("is_active", true)
      .maybeSingle();

    if (remoteError) throw remoteError;
    return (data as ProductWithOwner | null) ?? null;
  }
}

export async function generateCatalogBarcode() {
  if (!isTauriRuntime()) {
    const supabase = createClient();
    const { data } = await supabase
      .from("products")
      .select("barcode")
      .ilike("barcode", "ELB-%")
      .order("barcode", { ascending: false })
      .limit(1);

    let nextNum = 1;
    if (data && data.length > 0) {
      const match = data[0].barcode.match(/ELB-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }

    return `ELB-${String(nextNum).padStart(5, "0")}`;
  }

  try {
    return await invoke<string>("generate_next_local_barcode");
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

    console.warn("[catalog] generate_next_local_barcode unavailable, using Supabase fallback");
    const supabase = createClient();
    const { data } = await supabase
      .from("products")
      .select("barcode")
      .ilike("barcode", "ELB-%")
      .order("barcode", { ascending: false })
      .limit(1);

    let nextNum = 1;
    if (data && data.length > 0) {
      const match = data[0].barcode.match(/ELB-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }

    return `ELB-${String(nextNum).padStart(5, "0")}`;
  }
}

export async function saveCatalogProduct(input: UpsertLocalProductInput) {
  if (!isTauriRuntime()) {
    throw new Error("Guardado local solo disponible en Tauri");
  }

  return invoke<UpsertLocalProductResult>("upsert_local_product", { input });
}
