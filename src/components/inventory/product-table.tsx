/**
 * @file product-table.tsx
 * @description Inventory table aligned with the sales list system.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  Package,
  RefreshCw,
  Pencil,
  Tag,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getCatalogProductCounts,
  searchCatalogProductsByIntent,
} from "@/lib/local/catalog";
import type { Partner, ProductWithOwner } from "@/types/database";
import { cn } from "@/lib/utils";
import {
  getPartnerVisual,
  getStockTone,
  getStockVisual,
} from "./inventory-ui";

interface ProductTableProps {
  partners: Partner[];
  refreshTrigger?: number;
  onGenerateLabel?: (product: ProductWithOwner) => void;
  onEditProduct?: (product: ProductWithOwner) => void;
}

type ProductTableStockFilter = "all" | "ok" | "low" | "out";

interface ProductTableViewState {
  searchQuery: string;
  filterOwner: string | null;
  stockFilter: ProductTableStockFilter;
  selectedIndex: number | null;
}

const PAGE_SIZE = 50;
const PRODUCT_TABLE_VIEW_STATE_KEY = "dashboard:inventario:product-table:v1";

function extractSizes(description: string | null): string[] {
  if (!description) return [];
  const match = description.match(/Tallas:\s*([^|]+)/i);
  const source = match?.[1] ?? description;
  const unique = new Set(
    source
      .split(/[\s,;/|]+/g)
      .map((size) => size.trim())
      .filter(Boolean)
  );
  return Array.from(unique);
}

function buildProductSummary(product: ProductWithOwner): string {
  const sizes = extractSizes(product.description);
  if (sizes.length === 0) return product.name;

  const preview = sizes.slice(0, 3).join(" / ");
  const extra = sizes.length > 3 ? ` +${sizes.length - 3}` : "";
  return `${product.name} · ${preview}${extra}`;
}

function getStockTextClass(stockTone: ProductTableStockFilter) {
  switch (stockTone) {
    case "low":
      return "text-[10px] font-semibold uppercase tracking-tighter text-amber-600";
    case "out":
      return "text-[10px] font-semibold uppercase tracking-tighter text-rose-600";
    default:
      return "text-[10px] font-semibold uppercase tracking-tighter text-slate-300";
  }
}

export function ProductTable({
  partners,
  refreshTrigger = 0,
  onGenerateLabel,
  onEditProduct,
}: ProductTableProps) {
  const [products, setProducts] = useState<ProductWithOwner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterOwner, setFilterOwner] = useState<string | null>(null);
  const [stockFilter, setStockFilter] = useState<ProductTableStockFilter>("all");
  const [totalCount, setTotalCount] = useState(0);
  const [outCount, setOutCount] = useState(0);
  const [lowCount, setLowCount] = useState(0);
  const [okCount, setOkCount] = useState(0);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [viewStateRestored, setViewStateRestored] = useState(false);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentOffsetRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.sessionStorage.getItem(PRODUCT_TABLE_VIEW_STATE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<ProductTableViewState>;

      if (typeof parsed.searchQuery === "string") {
        setSearchQuery(parsed.searchQuery);
        setDebouncedSearch(parsed.searchQuery);
      }

      if (
        typeof parsed.filterOwner === "string" ||
        parsed.filterOwner === null
      ) {
        setFilterOwner(parsed.filterOwner);
      }

      if (
        parsed.stockFilter === "all" ||
        parsed.stockFilter === "ok" ||
        parsed.stockFilter === "low" ||
        parsed.stockFilter === "out"
      ) {
        setStockFilter(parsed.stockFilter);
      }

      if (
        (typeof parsed.selectedIndex === "number" &&
          Number.isInteger(parsed.selectedIndex) &&
          parsed.selectedIndex >= 0) ||
        parsed.selectedIndex === null
      ) {
        setSelectedIndex(parsed.selectedIndex);
      }
    } catch (error) {
      console.error("[ProductTable] state restore error:", error);
    } finally {
      setViewStateRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!viewStateRestored || typeof window === "undefined") return;

    const viewState: ProductTableViewState = {
      searchQuery,
      filterOwner,
      stockFilter,
      selectedIndex,
    };

    try {
      window.sessionStorage.setItem(
        PRODUCT_TABLE_VIEW_STATE_KEY,
        JSON.stringify(viewState)
      );
    } catch (error) {
      console.error("[ProductTable] state persist error:", error);
    }
  }, [viewStateRestored, searchQuery, filterOwner, stockFilter, selectedIndex]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 350);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  const fetchCounts = useCallback(async () => {
    try {
      const counts = await getCatalogProductCounts({
        search: debouncedSearch,
        ownerId: filterOwner,
      });

      setTotalCount(Number(counts.totalCount || 0));
      setOutCount(Number(counts.outCount || 0));
      setLowCount(Number(counts.lowCount || 0));
      setOkCount(Number(counts.availableCount || 0));
    } catch (error) {
      console.error("[ProductTable] count error:", error);
    }
  }, [debouncedSearch, filterOwner]);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    currentOffsetRef.current = 0;

    try {
      const result = await searchCatalogProductsByIntent({
        search: debouncedSearch,
        ownerId: filterOwner,
        stockFilter,
        limit: PAGE_SIZE,
        offset: 0,
      });

      setProducts(result);
      setHasMore(result.length === PAGE_SIZE);
      currentOffsetRef.current = result.length;
    } catch (error) {
      console.error("[ProductTable] fetch error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, filterOwner, stockFilter]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    try {
      const offset = currentOffsetRef.current;
      const batch = await searchCatalogProductsByIntent({
        search: debouncedSearch,
        ownerId: filterOwner,
        stockFilter,
        limit: PAGE_SIZE,
        offset,
      });

      setProducts((prev) => [...prev, ...batch]);
      setHasMore(batch.length === PAGE_SIZE);
      currentOffsetRef.current = offset + batch.length;
    } catch (error) {
      console.error("[ProductTable] loadMore error:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [debouncedSearch, filterOwner, hasMore, isLoadingMore, stockFilter]);

  useEffect(() => {
    if (!viewStateRestored) return;
    void fetchProducts();
    void fetchCounts();
  }, [fetchCounts, fetchProducts, refreshTrigger, viewStateRestored]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();

        if (products.length === 0) return;

        setSelectedIndex((prev) => {
          if (prev === null) return 0;
          if (e.key === "ArrowDown") {
            return Math.min(prev + 1, products.length - 1);
          }
          return Math.max(prev - 1, 0);
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [products]);

  useEffect(() => {
    if (selectedIndex !== null) {
      const row = document.getElementById(`product-row-${selectedIndex}`);
      if (row) {
        row.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (selectedIndex === null) return;

    if (products.length === 0) {
      setSelectedIndex(null);
      return;
    }

    if (selectedIndex >= products.length) {
      setSelectedIndex(products.length - 1);
    }
  }, [products.length, selectedIndex]);

  useEffect(() => {
    if (
      selectedIndex === null ||
      !hasMore ||
      isLoadingMore ||
      products.length === 0
    ) {
      return;
    }

    if (selectedIndex >= products.length - 8) {
      void loadMore();
    }
  }, [hasMore, isLoadingMore, loadMore, products.length, selectedIndex]);

  const hasActiveFilters = Boolean(
    searchQuery || filterOwner || stockFilter !== "all"
  );
  const refresh = () => {
    void fetchProducts();
    void fetchCounts();
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="space-y-3 border-b border-slate-100 px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Buscar por prenda, codigo o talla..."
            className="border-slate-200 bg-white pl-9 shadow-sm focus-visible:border-slate-900 focus-visible:ring-slate-900/10"
          />
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilterOwner(null)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                !filterOwner
                  ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              )}
            >
              Todas
            </button>
            {partners.map((partner) => {
              const visual = getPartnerVisual(partner.name);
              const isActive = filterOwner === partner.id;

              return (
                <button
                  key={partner.id}
                  onClick={() => setFilterOwner(isActive ? null : partner.id)}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                    isActive
                      ? "shadow-sm"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  )}
                  style={
                    isActive
                      ? {
                          borderColor: visual.softBorder,
                          backgroundColor: visual.softBackground,
                          color: visual.softText,
                        }
                      : undefined
                  }
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: visual.accent }}
                  />
                  {partner.display_name}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() =>
                setStockFilter(
                  stockFilter === "low" || stockFilter === "out"
                    ? "all"
                    : "low"
                )
              }
              className={cn(
                "flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                stockFilter === "low" || stockFilter === "out"
                  ? "border-amber-200 bg-amber-50 text-amber-700 shadow-sm"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              Requiere atencion
            </button>

            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setFilterOwner(null);
                  setStockFilter("all");
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
              >
                Limpiar filtros
              </button>
            )}

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {products.length} de {totalCount} producto{totalCount !== 1 ? "s" : ""}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                onClick={refresh}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3 text-sm">
          <button
            onClick={() => setStockFilter("all")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all",
              stockFilter === "all"
                ? "bg-slate-100 font-semibold text-slate-900"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            )}
          >
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            <span className="font-semibold">{totalCount}</span> total
          </button>
          <button
            onClick={() => setStockFilter(stockFilter === "ok" ? "all" : "ok")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all",
              stockFilter === "ok"
                ? "bg-emerald-50 font-semibold text-emerald-700"
                : "text-emerald-600 hover:bg-emerald-50/50 hover:text-emerald-700"
            )}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-semibold">{okCount}</span> disponibles
          </button>
          <button
            onClick={() => setStockFilter(stockFilter === "low" ? "all" : "low")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all",
              stockFilter === "low"
                ? "bg-amber-50 font-semibold text-amber-700"
                : "text-amber-600 hover:bg-amber-50/50 hover:text-amber-700"
            )}
          >
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="font-semibold">{lowCount}</span> por agotarse
          </button>
          <button
            onClick={() => setStockFilter(stockFilter === "out" ? "all" : "out")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all",
              stockFilter === "out"
                ? "bg-rose-50 font-semibold text-rose-700"
                : "text-rose-600 hover:bg-rose-50/50 hover:text-rose-700"
            )}
          >
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="font-semibold">{outCount}</span> sin stock
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
            <RefreshCw className="mb-4 h-8 w-8 animate-spin text-slate-300" />
            <p className="text-sm font-medium">Cargando inventario...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
            <Package className="mb-4 h-12 w-12 text-slate-300" strokeWidth={1.5} />
            <p className="mb-1 text-base font-medium text-slate-600">
              {totalCount === 0
                ? "No hay productos registrados"
                : "No se encontraron resultados"}
            </p>
            <p className="text-sm">
              {hasActiveFilters
                ? "Prueba cambiando la busqueda o los filtros"
                : "Agrega tu primera prenda al inventario"}
            </p>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 min-h-0">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 shadow-sm">
                  <tr>
                    <th className="w-28 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Barras</th>
                    <th className="w-20 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Codigo</th>
                    <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Prenda</th>
                    <th className="w-28 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Socia</th>
                    <th className="w-16 px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">Stock</th>
                    <th className="w-24 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Estado</th>
                    <th className="w-24 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">P. Unit</th>
                    <th className="w-20 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {products.map((product, index) => {
                    const visual = getPartnerVisual(product.owner.name);
                    const stockTone = getStockTone(product.stock, product.min_stock);
                    const stockVisual = getStockVisual(product.stock, product.min_stock);
                    const productSummary = buildProductSummary(product);
                    const isSelected = index === selectedIndex;
                    const barStyle = { backgroundColor: visual.accent };

                    return (
                      <tr
                        id={`product-row-${index}`}
                        key={product.id}
                        onClick={() => setSelectedIndex(index)}
                        className={`group transition-colors border-b border-slate-100/60 cursor-pointer ${
                          isSelected ? "bg-indigo-50/60" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-4 py-1.5 align-middle relative">
                          <div
                            className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-md"
                            style={barStyle}
                          />
                          <span className="block font-mono text-[11px] font-medium text-slate-800 uppercase ml-1">
                            {product.barcode}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 align-middle">
                          {product.sku ? (
                            <span
                              className="block font-mono text-[10px] text-slate-600 uppercase"
                              title="SKU"
                            >
                              {product.sku}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-1.5 align-middle">
                          <span
                            className="text-[11px] text-slate-600 truncate block max-w-[340px]"
                            title={productSummary}
                          >
                            {productSummary}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 align-middle">
                          <span className="flex items-center gap-1.5 truncate text-[11px] font-medium text-slate-700">
                            <span
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: visual.accent }}
                            />
                            <span className="truncate block max-w-[110px]">
                              {product.owner.display_name}
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-center align-middle">
                          <span className="block font-mono text-[13px] font-bold text-slate-900">
                            {product.stock}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 align-middle">
                          <span className={getStockTextClass(stockTone)}>
                            {stockTone === "ok" ? "Disponible" : stockVisual.label}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-right align-middle">
                          <span className="font-mono text-[13px] font-bold tabular-nums text-slate-900">
                            ${Number(product.sale_price).toFixed(2)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 align-middle text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            {onEditProduct && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 rounded-md bg-slate-50 text-slate-500 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 shadow-sm"
                                title="Editar producto"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onEditProduct(product);
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                            {onGenerateLabel && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-800 border border-emerald-200 shadow-sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onGenerateLabel(product);
                                }}
                                title="Imprimir etiqueta"
                              >
                                <Tag className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>

            <div className="mt-auto flex shrink-0 items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5 shadow-[0_-2px_4px_-2px_rgba(0,0,0,0.03)]">
              {hasMore ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="h-8 gap-1.5 px-3 text-xs text-slate-600"
                >
                  {isLoadingMore ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  Cargar mas
                </Button>
              ) : (
                <div />
              )}

              <div className="ml-auto flex items-center">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
                  {hasMore
                    ? `Cargados (${products.length} de ${totalCount} productos)`
                    : `Total (${products.length} productos)`}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

