"use client";

import { invoke } from "@tauri-apps/api/core";
import { createClient } from "@/lib/supabase/client";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";
import { sortPartnersByBusinessOrder } from "@/lib/partners";
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
  sale_price_x3?: number | null;
  sale_price_x6?: number | null;
  sale_price_x12?: number | null;
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

const SEARCH_MIN_TOKEN_LENGTH = 2;
const SEARCH_FETCH_MULTIPLIER = 6;
const SEARCH_MIN_CANDIDATES = 200;
const SEARCH_MAX_CANDIDATES = 1200;

interface ProductCounts {
  totalCount: number;
  outCount: number;
  lowCount: number;
  availableCount: number;
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
  salePriceX3?: number | null;
  salePriceX6?: number | null;
  salePriceX12?: number | null;
  stock: number;
  minStock: number;
  isActive: boolean;
}

interface UpsertLocalProductResult {
  productId: string;
  movementDelta: number;
}

function normalizePartnerDisplayName(name: string | null | undefined, displayName: string): string {
  if ((name || "").toLowerCase() === "todos") {
    return "Medias";
  }
  return displayName;
}

function normalizePartnerRecord<T extends Pick<Partner, "name" | "display_name">>(partner: T): T {
  return {
    ...partner,
    display_name: normalizePartnerDisplayName(partner.name, partner.display_name),
  };
}

function mapLocalProduct(record: LocalProductRecord, owner: LocalPartnerRecord): ProductWithOwner {
  const normalizedOwner = normalizePartnerRecord(owner);
  return {
    ...record,
    id: record.remote_id || record.id,
    owner_id: normalizedOwner.remote_id || normalizedOwner.id,
    owner: normalizedOwner,
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
  return data.map((partner) => {
    const normalized = normalizePartnerRecord(partner);
    return {
      ...normalized,
      id: normalized.id,
      remote_id: normalized.id,
    };
  });
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchTerm(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

function normalizeCodeKey(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isLikelyExactCodeQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (trimmed.length < 2 || trimmed.length > 32) return false;
  return /\d/.test(trimmed);
}

function isExactBarcodeOrSkuMatch(product: Pick<ProductWithOwner, "barcode" | "sku">, query: string) {
  const queryCode = normalizeCodeKey(query);
  if (!queryCode) return false;

  return (
    normalizeCodeKey(product.barcode) === queryCode ||
    normalizeCodeKey(product.sku) === queryCode
  );
}

function getSearchableProductText(product: ProductWithOwner) {
  return normalizeSearchText(`${product.name} ${product.barcode} ${product.sku ?? ""}`);
}

function splitWords(value: string) {
  return value.split(" ").filter(Boolean);
}

function hasAllRequiredTokens(searchableText: string, tokens: string[]) {
  const requiredTokens = tokens.filter(
    (token) => token.length >= SEARCH_MIN_TOKEN_LENGTH
  );
  if (requiredTokens.length === 0) return true;
  return requiredTokens.every((token) => searchableText.includes(token));
}

function scoreOrderedWordPrefixMatch(words: string[], tokens: string[]) {
  if (words.length === 0 || tokens.length === 0) return 0;

  let cursor = 0;
  let score = 0;
  let gapPenalty = 0;

  for (const token of tokens) {
    let foundAt = -1;
    for (let index = cursor; index < words.length; index += 1) {
      if (words[index].startsWith(token)) {
        foundAt = index;
        break;
      }
    }

    if (foundAt === -1) {
      return 0;
    }

    if (token.length >= 3) {
      score += 150;
    } else if (token.length === 2) {
      score += 110;
    } else {
      score += 70;
    }

    gapPenalty += Math.max(0, foundAt - cursor);
    cursor = foundAt + 1;
  }

  score += 500;
  score -= gapPenalty * 60;
  return Math.max(score, 0);
}

function scoreProductByIntent(product: ProductWithOwner, rawQuery: string, tokens: string[]) {
  const normalizedQuery = normalizeSearchText(rawQuery);
  const normalizedName = normalizeSearchText(product.name);
  const normalizedBarcode = normalizeSearchText(product.barcode);
  const normalizedSku = normalizeSearchText(product.sku ?? "");
  const searchableText = getSearchableProductText(product);
  const searchableWords = splitWords(searchableText);
  const nameWords = splitWords(normalizedName);
  const rankingTokens = tokens.filter(Boolean);
  const requiredTokens = rankingTokens.filter(
    (token) => token.length >= SEARCH_MIN_TOKEN_LENGTH
  );

  let score = 0;

  const compactQuery = normalizeCodeKey(rawQuery);
  const compactBarcode = normalizeCodeKey(normalizedBarcode);
  const compactSku = normalizeCodeKey(normalizedSku);

  if (compactQuery && (compactBarcode === compactQuery || compactSku === compactQuery)) {
    // El match exacto por codigo/SKU siempre debe ganar sobre coincidencias parciales.
    score += 5000;
  }
  if (normalizedName === normalizedQuery) {
    score += 900;
  }
  if (normalizedName.startsWith(normalizedQuery)) {
    score += 700;
  }
  if (normalizedQuery && searchableText.includes(normalizedQuery)) {
    score += 500;
  }
  if (
    requiredTokens.length > 1 &&
    requiredTokens.every((token) => searchableText.includes(token))
  ) {
    score += 400;
  }

  score += scoreOrderedWordPrefixMatch(nameWords, rankingTokens);

  for (const token of requiredTokens) {
    if (searchableWords.some((word) => word.startsWith(token))) {
      score += 70;
    } else if (searchableText.includes(token)) {
      score += 30;
    }
  }

  if (product.stock > 0) {
    score += 10;
  }

  return score;
}

function buildSearchPattern(search: string): string | null {
  const normalized = search
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;
  return `%${normalized.split(" ").join("%")}%`;
}

export async function searchCatalogProductsByIntent(
  filters: ProductQuery = {}
): Promise<ProductWithOwner[]> {
  const search = filters.search?.trim();
  if (!search) {
    return getCatalogProducts(filters);
  }

  const limit = Math.max(filters.limit ?? 50, 1);
  const offset = Math.max(filters.offset ?? 0, 0);
  const neededWindow = offset + limit;
  const candidateLimit = Math.min(
    Math.max(neededWindow * SEARCH_FETCH_MULTIPLIER, SEARCH_MIN_CANDIDATES),
    SEARCH_MAX_CANDIDATES
  );

  const tokens = tokenizeSearchTerm(search);
  const uniqueTokens = Array.from(new Set(tokens));
  const tokenQueries =
    uniqueTokens.length > 1
      ? uniqueTokens.filter((token) => token.length >= SEARCH_MIN_TOKEN_LENGTH)
      : [];

  const sharedFilters: ProductQuery = {
    ownerId: filters.ownerId ?? null,
    stockFilter: filters.stockFilter ?? "all",
    limit: candidateLimit,
    offset: 0,
  };

  const searches = [search, ...tokenQueries];
  const datasets = await Promise.all(
    searches.map((term) =>
      getCatalogProducts({
        ...sharedFilters,
        search: term,
      })
    )
  );

  const merged = new Map<string, ProductWithOwner>();
  for (const dataset of datasets) {
    for (const product of dataset) {
      merged.set(product.id, product);
    }
  }

  if (isLikelyExactCodeQuery(search)) {
    const hasExactInCandidates = Array.from(merged.values()).some((product) =>
      isExactBarcodeOrSkuMatch(product, search)
    );

    if (!hasExactInCandidates) {
      try {
        const exactByCode = await findCatalogProductByBarcode(search);
        if (exactByCode) {
          merged.set(exactByCode.id, exactByCode);
        }
      } catch (error) {
        console.warn("[catalog] exact code lookup failed:", error);
      }
    }
  }

  const ranked = Array.from(merged.values())
    .map((product) => {
      const searchableText = getSearchableProductText(product);
      return {
        product,
        searchableText,
        score: scoreProductByIntent(product, search, uniqueTokens),
      };
    })
    .filter(({ searchableText }) => hasAllRequiredTokens(searchableText, uniqueTokens))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.product.name.localeCompare(right.product.name, "es", {
        sensitivity: "base",
      });
    })
    .map(({ product }) => product);

  if (ranked.length === 0) {
    return [];
  }

  return ranked.slice(offset, offset + limit);
}

async function hydratePartnersFromSupabase() {
  const supabase = createClient();
  const { data, error } = await supabase.from("partners").select("*").order("name");

  if (error) throw error;

  const partners = sortPartnersByBusinessOrder(
    ((data as Partner[]) || []).map((partner) => normalizePartnerRecord(partner))
  );
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
    const term = buildSearchPattern(filters.search);
    if (term) {
      query = query.or(`name.ilike.${term},barcode.ilike.${term},sku.ilike.${term}`);
    }
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
    return sortPartnersByBusinessOrder(
      ((data as Partner[]) || []).map((partner) => normalizePartnerRecord(partner))
    );
  }

  try {
    const localPartners = await invoke<LocalPartnerRecord[]>("list_local_partners");
    if (localPartners.length > 0) {
      return sortPartnersByBusinessOrder(
        localPartners.map((partner) => ({
          ...normalizePartnerRecord(partner),
          id: partner.remote_id || partner.id,
        }))
      );
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
    return sortPartnersByBusinessOrder(
      ((data as Partner[]) || []).map((partner) => normalizePartnerRecord(partner))
    );
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
      const term = buildSearchPattern(filters.search);
      if (term) {
        query = query.or(`name.ilike.${term},barcode.ilike.${term},sku.ilike.${term}`);
      }
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
      const term = buildSearchPattern(filters.search);
      if (term) {
        query = query.or(`name.ilike.${term},barcode.ilike.${term},sku.ilike.${term}`);
      }
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

export async function getCatalogProductsByIds(ids: string[]) {
  const uniqueIds = Array.from(
    new Set(ids.map((value) => value.trim()).filter(Boolean))
  );

  if (uniqueIds.length === 0) {
    return [] as ProductWithOwner[];
  }

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
      .in("id", uniqueIds);

    if (error) throw error;
    return ((data as ProductWithOwner[]) || []).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  try {
    const products = await invoke<LocalProductWithOwnerRecord[]>(
      "list_local_products_by_ids",
      {
        ids: uniqueIds,
      }
    );

    return products
      .map((record) => normalizeLocalProductWithOwner(record))
      .filter(
        (
          entry
        ): entry is { product: LocalProductRecord; owner: LocalPartnerRecord } =>
          Boolean(entry)
      )
      .map(({ product, owner }) => mapLocalProduct(product, owner));
  } catch (error) {
    if (!isMissingTauriCommandError(error)) {
      throw error;
    }

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
      .in("id", uniqueIds);

    if (remoteError) throw remoteError;
    return ((data as ProductWithOwner[]) || []).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }
}

export async function getCatalogProductCounts(filters: Pick<ProductQuery, "search" | "ownerId"> = {}) {
  if (!isTauriRuntime()) {
    return supabaseCountProducts(filters);
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
    return supabaseCountProducts(filters);
  }
}

async function supabaseCountProducts(filters: Pick<ProductQuery, "search" | "ownerId"> = {}): Promise<ProductCounts> {
  const supabase = createClient();

  function buildBaseQuery() {
    let q = supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    if (filters.ownerId) q = q.eq("owner_id", filters.ownerId);
    if (filters.search?.trim()) {
      const term = buildSearchPattern(filters.search);
      if (term) {
        q = q.or(`name.ilike.${term},barcode.ilike.${term},sku.ilike.${term}`);
      }
    }
    return q;
  }

  const [totalRes, outRes, lowRes] = await Promise.all([
    buildBaseQuery(),
    buildBaseQuery().lte("stock", 0),
    buildBaseQuery().gt("stock", 0).filter("stock", "lte", "min_stock"),
  ]);

  const totalCount = totalRes.count ?? 0;
  const outCount = outRes.count ?? 0;
  const lowCount = lowRes.count ?? 0;
  const availableCount = Math.max(0, totalCount - outCount - lowCount);

  return { totalCount, outCount, lowCount, availableCount };
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
