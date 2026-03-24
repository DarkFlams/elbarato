"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Search, Tags } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getCatalogProductCounts,
  saveCatalogProduct,
  searchCatalogProductsByIntent,
} from "@/lib/local/catalog";
import {
  formatPriceValue,
  type ProductPriceField,
} from "@/lib/pricing";
import type { Partner, ProductWithOwner } from "@/types/database";
import { cn } from "@/lib/utils";
import { getPartnerVisual } from "@/components/inventory/inventory-ui";

interface PriceListTableProps {
  partners: Partner[];
  refreshTrigger?: number;
}

interface PriceEditFocus {
  productId: string;
  field: ProductPriceField;
  value: string;
}

interface PriceListViewState {
  searchQuery: string;
  filterOwner: string | null;
  selectedIndex: number | null;
}

const PAGE_SIZE = 50;
const PRICE_LIST_VIEW_STATE_KEY = "dashboard:precios:table:v1";

function parseEditablePrice(raw: string, field: ProductPriceField) {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (field === "sale_price") {
      throw new Error("El precio normal es obligatorio");
    }
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Ingresa un precio valido");
  }

  if (field === "sale_price" && parsed <= 0) {
    throw new Error("El precio normal debe ser mayor a 0");
  }

  return Number(parsed.toFixed(2));
}

async function upsertProductRemote(
  product: ProductWithOwner,
  prices: Record<ProductPriceField, number | null>
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("upsert_product_with_movement", {
    p_product_id: product.id,
    p_barcode: product.barcode,
    p_name: product.name,
    p_description: product.description,
    p_category: product.category,
    p_owner_id: product.owner_id,
    p_purchase_price: product.purchase_price,
    p_sale_price: prices.sale_price,
    p_sale_price_x3: prices.sale_price_x3,
    p_sale_price_x6: prices.sale_price_x6,
    p_sale_price_x12: prices.sale_price_x12,
    p_stock: product.stock,
    p_min_stock: product.min_stock,
    p_is_active: product.is_active,
    p_sku: product.sku,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function saveProductPrices(
  product: ProductWithOwner,
  prices: Record<ProductPriceField, number | null>
) {
  return saveCatalogProduct({
    productId: product.id,
    remoteId: product.id,
    barcode: product.barcode,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    ownerId: product.owner_id,
    purchasePrice: product.purchase_price,
    salePrice: prices.sale_price ?? product.sale_price,
    salePriceX3: prices.sale_price_x3,
    salePriceX6: prices.sale_price_x6,
    salePriceX12: prices.sale_price_x12,
    stock: product.stock,
    minStock: product.min_stock,
    isActive: product.is_active,
  }).catch(async (localError) => {
    console.warn("[PriceListTable] local price save failed, using remote fallback", localError);
    return upsertProductRemote(product, prices);
  });
}

function getProductPriceFieldValue(product: ProductWithOwner, field: ProductPriceField) {
  switch (field) {
    case "sale_price":
      return product.sale_price;
    case "sale_price_x3":
      return product.sale_price_x3;
    case "sale_price_x6":
      return product.sale_price_x6;
    case "sale_price_x12":
      return product.sale_price_x12;
    default:
      return product.sale_price;
  }
}

function getPriceCellKey(productId: string, field: ProductPriceField) {
  return `${productId}:${field}`;
}

export function PriceListTable({
  partners,
  refreshTrigger = 0,
}: PriceListTableProps) {
  const [products, setProducts] = useState<ProductWithOwner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterOwner, setFilterOwner] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [viewStateRestored, setViewStateRestored] = useState(false);
  const [editingPriceContext, setEditingPriceContext] = useState<PriceEditFocus | null>(null);
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentOffsetRef = useRef(0);
  const activePriceInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.sessionStorage.getItem(PRICE_LIST_VIEW_STATE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Partial<PriceListViewState>;
      if (typeof parsed.searchQuery === "string") {
        setSearchQuery(parsed.searchQuery);
        setDebouncedSearch(parsed.searchQuery);
      }

      if (typeof parsed.filterOwner === "string" || parsed.filterOwner === null) {
        setFilterOwner(parsed.filterOwner);
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
      console.error("[PriceListTable] state restore error:", error);
    } finally {
      setViewStateRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!viewStateRestored || typeof window === "undefined") return;

    const viewState: PriceListViewState = {
      searchQuery,
      filterOwner,
      selectedIndex,
    };

    try {
      window.sessionStorage.setItem(
        PRICE_LIST_VIEW_STATE_KEY,
        JSON.stringify(viewState)
      );
    } catch (error) {
      console.error("[PriceListTable] state persist error:", error);
    }
  }, [filterOwner, searchQuery, selectedIndex, viewStateRestored]);

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
    } catch (error) {
      console.error("[PriceListTable] count error:", error);
    }
  }, [debouncedSearch, filterOwner]);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    currentOffsetRef.current = 0;

    try {
      const result = await searchCatalogProductsByIntent({
        search: debouncedSearch,
        ownerId: filterOwner,
        stockFilter: "all",
        limit: PAGE_SIZE,
        offset: 0,
      });

      setProducts(result);
      setHasMore(result.length === PAGE_SIZE);
      currentOffsetRef.current = result.length;
    } catch (error) {
      console.error("[PriceListTable] fetch error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, filterOwner]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    try {
      const offset = currentOffsetRef.current;
      const batch = await searchCatalogProductsByIntent({
        search: debouncedSearch,
        ownerId: filterOwner,
        stockFilter: "all",
        limit: PAGE_SIZE,
        offset,
      });

      setProducts((prev) => [...prev, ...batch]);
      setHasMore(batch.length === PAGE_SIZE);
      currentOffsetRef.current = offset + batch.length;
    } catch (error) {
      console.error("[PriceListTable] loadMore error:", error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [debouncedSearch, filterOwner, hasMore, isLoadingMore]);

  useEffect(() => {
    if (!viewStateRestored) return;
    void fetchProducts();
    void fetchCounts();
  }, [fetchCounts, fetchProducts, refreshTrigger, viewStateRestored]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();

        if (products.length === 0) return;

        setSelectedIndex((prev) => {
          if (prev === null) return 0;
          if (event.key === "ArrowDown") {
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
      const row = document.getElementById(`price-row-${selectedIndex}`);
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

  useEffect(() => {
    if (!editingPriceContext) return;

    const rafId = window.requestAnimationFrame(() => {
      activePriceInputRef.current?.focus();
      activePriceInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [editingPriceContext]);

  const refresh = () => {
    void fetchProducts();
    void fetchCounts();
  };

  const hasActiveFilters = Boolean(searchQuery || filterOwner);

  const handleStartEdit = (
    event: React.MouseEvent<HTMLButtonElement>,
    product: ProductWithOwner,
    field: ProductPriceField
  ) => {
    event.stopPropagation();
    if (savingCellKey) return;

    setEditingPriceContext({
      productId: product.id,
      field,
      value: getProductPriceFieldValue(product, field)?.toString() ?? "",
    });
  };

  const handleCommitPrices = async () => {
    if (!editingPriceContext) return;
    const { productId, field, value } = editingPriceContext;
    const cellKey = getPriceCellKey(productId, field);

    if (savingCellKey === cellKey) return;

    const product = products.find((current) => current.id === productId);
    if (!product) {
      setEditingPriceContext(null);
      return;
    }

    try {
      const parsedValue = parseEditablePrice(value, field);
      const currentValue = getProductPriceFieldValue(product, field);

      if (parsedValue === currentValue) {
        setEditingPriceContext(null);
        return;
      }

      const nextPrices: Record<ProductPriceField, number | null> = {
        sale_price: product.sale_price,
        sale_price_x3: product.sale_price_x3,
        sale_price_x6: product.sale_price_x6,
        sale_price_x12: product.sale_price_x12,
      };
      nextPrices[field] = parsedValue;

      setSavingCellKey(cellKey);

      await saveProductPrices(product, nextPrices);

      setProducts((prev) =>
        prev.map((current) =>
          current.id === product.id
            ? {
                ...current,
                sale_price: nextPrices.sale_price ?? current.sale_price,
                sale_price_x3: nextPrices.sale_price_x3,
                sale_price_x6: nextPrices.sale_price_x6,
                sale_price_x12: nextPrices.sale_price_x12,
              }
            : current
        )
      );

      setEditingPriceContext(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al guardar precio";
      toast.error(message);
      window.setTimeout(() => {
        activePriceInputRef.current?.focus();
        activePriceInputRef.current?.select();
      }, 0);
    } finally {
      setSavingCellKey(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingPriceContext(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="space-y-3 border-b border-slate-100 px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Buscar por producto, codigo o socia..."
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

          <div className="ml-auto flex items-center gap-2">
            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setFilterOwner(null);
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
              >
                Limpiar filtros
              </button>
            )}

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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
            <RefreshCw className="mb-4 h-8 w-8 animate-spin text-slate-300" />
            <p className="text-sm font-medium">Cargando lista de precios...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
            <Tags className="mb-4 h-12 w-12 text-slate-300" strokeWidth={1.5} />
            <p className="mb-1 text-base font-medium text-slate-600">
              {totalCount === 0 ? "No hay productos registrados" : "No se encontraron resultados"}
            </p>
            <p className="text-sm">
              {hasActiveFilters
                ? "Prueba cambiando la busqueda o los filtros"
                : "La lista de precios aparecera aqui"}
            </p>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 min-h-0">
              <table className="w-full whitespace-nowrap text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 shadow-sm">
                  <tr>
                    <th className="w-28 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Codigo
                    </th>
                    <th className="w-28 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Socia
                    </th>
                    <th className="w-16 px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Stock
                    </th>
                    <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Producto
                    </th>
                    <th className="w-[116px] border-l border-slate-200 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      PVP Normal
                    </th>
                    <th className="w-[106px] border-l border-slate-200 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      PVP x3
                    </th>
                    <th className="w-[106px] border-l border-slate-200 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      PVP x6
                    </th>
                    <th className="w-[106px] border-l border-slate-200 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      PVP x12
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {products.map((product, index) => {
                    const visual = getPartnerVisual(product.owner.name);
                    const isSelected = index === selectedIndex;

                    const renderPriceCell = (
                      field: ProductPriceField,
                      title: string
                    ) => {
                      const cellKey = getPriceCellKey(product.id, field);
                      const isEditing =
                        editingPriceContext?.productId === product.id &&
                        editingPriceContext.field === field;
                      const isSaving = savingCellKey === cellKey;

                      if (isEditing) {
                        return (
                          <div className="flex h-[42px] w-full items-center justify-end gap-2 px-3">
                            <Input
                              ref={(node) => {
                                if (isEditing) {
                                  activePriceInputRef.current = node;
                                }
                              }}
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              spellCheck={false}
                              value={editingPriceContext.value}
                              onChange={(event) =>
                                setEditingPriceContext((current) =>
                                  current &&
                                  current.productId === product.id &&
                                  current.field === field
                                    ? { ...current, value: event.target.value }
                                    : current
                                )
                              }
                              onClick={(event) => event.stopPropagation()}
                              onFocus={(event) => event.currentTarget.select()}
                              onBlur={() => void handleCommitPrices()}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void handleCommitPrices();
                                  return;
                                }

                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  handleCancelEdit();
                                }
                              }}
                              disabled={isSaving}
                              className="h-9 w-full min-w-[92px] border-indigo-200 bg-white px-2 text-right font-mono text-[15px] font-black tracking-tight tabular-nums shadow-none focus-visible:ring-indigo-500/20"
                            />
                            {isSaving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                            ) : null}
                          </div>
                        );
                      }

                      return (
                        <button
                          type="button"
                          title={title}
                          onClick={(event) => handleStartEdit(event, product, field)}
                          disabled={Boolean(savingCellKey)}
                          className="group/price inline-flex h-[42px] w-full cursor-pointer items-center justify-end px-4 transition-colors hover:bg-slate-100/90 disabled:cursor-wait disabled:opacity-60"
                        >
                          <span className="font-mono text-[15px] font-black tracking-tight tabular-nums text-slate-900">
                            {formatPriceValue(getProductPriceFieldValue(product, field))}
                          </span>
                        </button>
                      );
                    };

                    return (
                      <tr
                        id={`price-row-${index}`}
                        key={product.id}
                        onClick={() => setSelectedIndex(index)}
                        className={`group cursor-pointer border-b border-slate-100/60 transition-colors ${
                          isSelected ? "bg-indigo-50/60" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="relative px-4 py-1.5 align-middle">
                          <div
                            className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-r-md"
                            style={{ backgroundColor: visual.accent }}
                          />
                          <span className="ml-1 block font-mono text-[11px] font-medium uppercase text-slate-800">
                            {product.sku || product.barcode}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 align-middle">
                          <span className="flex items-center gap-1.5 truncate text-[11px] font-medium text-slate-700">
                            <span
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: visual.accent }}
                            />
                            <span className="block max-w-[110px] truncate">
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
                          <span className="block max-w-[360px] truncate text-[11px] text-slate-600">
                            {product.name}
                          </span>
                        </td>
                        <td className="border-l border-slate-200/80 p-0 text-right align-middle">
                          {renderPriceCell("sale_price", "Editar precio normal")}
                        </td>
                        <td className="border-l border-slate-200/80 p-0 text-right align-middle">
                          {renderPriceCell("sale_price_x3", "Editar precio x3")}
                        </td>
                        <td className="border-l border-slate-200/80 p-0 text-right align-middle">
                          {renderPriceCell("sale_price_x6", "Editar precio x6")}
                        </td>
                        <td className="border-l border-slate-200/80 p-0 text-right align-middle">
                          {renderPriceCell("sale_price_x12", "Editar precio x12")}
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
