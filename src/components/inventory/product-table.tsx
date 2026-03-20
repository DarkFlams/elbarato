/**
 * @file product-table.tsx
 * @description Tabla de productos local-first con paginacion incremental.
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getCatalogProductCounts, getCatalogProducts } from "@/lib/local/catalog";
import type { Partner, ProductWithOwner } from "@/types/database";
import { cn } from "@/lib/utils";
import { ProductForm } from "./product-form";
import {
  getPartnerVisual,
  getStockTone,
  getStockVisual,
} from "./inventory-ui";

interface ProductTableProps {
  partners: Partner[];
  refreshTrigger?: number;
  onGenerateLabel?: (product: ProductWithOwner) => void;
}

const PAGE_SIZE = 50;

function extractSizes(description: string | null): string[] {
  if (!description) return [];
  const match = description.match(/Tallas:\s*([^|]+)/i);
  const source = match?.[1] ?? description;
  const unique = new Set(
    source.split(/[\s,;/|]+/g).map((size) => size.trim()).filter(Boolean)
  );
  return Array.from(unique);
}

function splitMainAndSizesName(productName: string, sizes: string[]) {
  return {
    mainName: productName,
    sizesLabel: sizes.slice(0, 5),
    extraCount: sizes.length > 5 ? sizes.length - 5 : 0,
  };
}

export function ProductTable({
  partners,
  refreshTrigger = 0,
  onGenerateLabel,
}: ProductTableProps) {
  const [products, setProducts] = useState<ProductWithOwner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterOwner, setFilterOwner] = useState<string | null>(null);
  const [stockFilter, setStockFilter] = useState<"all" | "ok" | "low" | "out">("all");
  const [totalCount, setTotalCount] = useState(0);
  const [outCount, setOutCount] = useState(0);
  const [lowCount, setLowCount] = useState(0);
  const [okCount, setOkCount] = useState(0);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentOffsetRef = useRef(0);

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
      const result = await getCatalogProducts({
        search: debouncedSearch,
        ownerId: filterOwner,
        stockFilter,
        limit: PAGE_SIZE,
        offset: 0,
      });

      setProducts(result);
      setHasMore(result.length === PAGE_SIZE);
      currentOffsetRef.current = PAGE_SIZE;
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
      const batch = await getCatalogProducts({
        search: debouncedSearch,
        ownerId: filterOwner,
        stockFilter,
        limit: PAGE_SIZE,
        offset,
      });

      setProducts((prev) => [...prev, ...batch]);
      setHasMore(batch.length === PAGE_SIZE);
      currentOffsetRef.current = offset + PAGE_SIZE;
    } catch (error) {
      console.error("[ProductTable] loadMore error:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [debouncedSearch, filterOwner, hasMore, isLoadingMore, stockFilter]);

  useEffect(() => {
    void fetchProducts();
    void fetchCounts();
  }, [fetchCounts, fetchProducts, refreshTrigger]);

  const hasActiveFilters = Boolean(searchQuery || filterOwner || stockFilter !== "all");

  const refresh = () => {
    void fetchProducts();
    void fetchCounts();
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
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
                setStockFilter(stockFilter === "low" || stockFilter === "out" ? "all" : "low")
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

      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-[200px] items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : products.length === 0 ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-slate-400">
            <Package className="h-10 w-10 opacity-30" />
            <p className="text-sm">
              {totalCount === 0
                ? "No hay productos registrados"
                : "No se encontraron resultados"}
            </p>
          </div>
        ) : (
          <>
            <table className="w-full text-left border-collapse table-fixed">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <tr>
                <th className="w-28 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Barras</th>
                <th className="w-20 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Código</th>
                <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Prenda</th>
                <th className="w-[120px] px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Socia</th>
                <th className="w-16 px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Stock</th>
                <th className="w-[85px] px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">Estado</th>
                <th className="w-20 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">P. Unit</th>
                <th className="w-20 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {products.map((product) => {
                const visual = getPartnerVisual(product.owner.name);
                const stockVisual = getStockVisual(product.stock, product.min_stock);
                const sizes = extractSizes(product.description);
                const display = splitMainAndSizesName(product.name, sizes);

                return (
                  <tr
                    key={product.id}
                    className="group transition-colors hover:bg-slate-50 border-b border-slate-100/60"
                  >
                    {/* Barras */}
                    <td className="px-4 py-1.5 align-middle">
                      <span className="block font-mono text-[11px] font-medium text-slate-800 uppercase">
                        {product.barcode}
                      </span>
                    </td>

                    {/* Código (SKU) */}
                    <td className="px-4 py-1.5 align-middle">
                      {product.sku ? (
                        <span className="block font-mono text-[10px] text-slate-600 uppercase" title="SKU">
                          {product.sku}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-300">-</span>
                      )}
                    </td>

                    {/* Prenda & Tallas */}
                    <td className="px-4 py-1.5 align-middle">
                      <div className="flex flex-col gap-0.5 justify-center">
                        <span className="truncate text-[12px] font-semibold text-slate-900 leading-tight block">
                          {display.mainName}
                        </span>
                        {sizes.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {display.sizesLabel.map((size) => (
                              <Badge
                                key={`${product.id}-${size}`}
                                variant="outline"
                                className="h-3.5 border-slate-200 bg-slate-100/50 px-1 py-0 text-[10px] font-medium text-slate-600 uppercase tracking-tighter"
                              >
                                {size}
                              </Badge>
                            ))}
                            {display.extraCount ? (
                              <Badge
                                variant="outline"
                                className="h-3.5 border-slate-200 bg-white px-1 py-0 text-[10px] text-slate-400 tracking-tighter"
                              >
                                +{display.extraCount}
                              </Badge>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Socia */}
                    <td className="px-2 py-1.5 align-middle">
                      <span className="flex items-center gap-1.5 truncate text-[11px] font-medium text-slate-700">
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full shadow-sm"
                          style={{ backgroundColor: visual.accent }}
                          title={product.owner.name}
                        />
                        <span className="truncate">{product.owner.display_name}</span>
                      </span>
                    </td>

                    {/* Stock */}
                    <td className="px-2 py-1.5 text-right align-middle">
                      <span className="block font-mono text-[13px] font-bold text-slate-900 leading-none">
                        {product.stock}
                      </span>
                    </td>

                    {/* Estado */}
                    <td className="px-2 py-1.5 text-center align-middle">
                      {getStockTone(product.stock, product.min_stock) !== "ok" ? (
                        <Badge
                          variant="outline"
                          className={cn("h-4 min-w-[65px] justify-center px-1 py-0 text-[9px] uppercase tracking-tighter leading-none mx-auto", stockVisual.className)}
                        >
                          {stockVisual.label}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-slate-300">-</span>
                      )}
                    </td>

                    {/* P. Unit */}
                    <td className="px-4 py-1.5 text-right align-middle">
                      <span className="font-mono text-[13px] font-bold tabular-nums text-slate-900">
                        ${Number(product.sale_price).toFixed(2)}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td className="px-2 py-1.5 align-middle text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <ProductForm
                          partners={partners}
                          product={product}
                          onSaved={refresh}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 rounded-md bg-slate-50 text-slate-500 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 shadow-sm"
                              title="Editar producto"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          }
                        />
                        {onGenerateLabel && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-800 border border-emerald-200 shadow-sm"
                            onClick={() => onGenerateLabel(product)}
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

          {hasMore && (
            <div className="flex justify-center py-4 border-t border-slate-100 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)] z-10 sticky bottom-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="gap-2 text-slate-600"
                >
                  {isLoadingMore ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  Cargar mas productos
                </Button>
              </div>
            )}
          </>
        )}
      </ScrollArea>
    </div>
  );
}
