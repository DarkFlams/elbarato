"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Search, Tags } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
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
  product: ProductWithOwner;
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
  const [isSavingPrices, setIsSavingPrices] = useState(false);
  const [priceFormValues, setPriceFormValues] = useState<Record<ProductPriceField, string>>({
    sale_price: "",
    sale_price_x3: "",
    sale_price_x6: "",
    sale_price_x12: "",
  });

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentOffsetRef = useRef(0);

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
    setPriceFormValues({
      sale_price: getProductPriceFieldValue(product, "sale_price")?.toString() ?? "",
      sale_price_x3: getProductPriceFieldValue(product, "sale_price_x3")?.toString() ?? "",
      sale_price_x6: getProductPriceFieldValue(product, "sale_price_x6")?.toString() ?? "",
      sale_price_x12: getProductPriceFieldValue(product, "sale_price_x12")?.toString() ?? "",
    });
    setEditingPriceContext({ productId: product.id, field, product });
    
    // Auto focus the correct input field after a micro-delay for the dialog to open
    setTimeout(() => {
      document.getElementById(`edit-field-${field}`)?.focus();
    }, 50);
  };

  const handleCommitPrices = async () => {
    if (!editingPriceContext) return;
    setIsSavingPrices(true);
    
    const { product } = editingPriceContext;

    try {
      const parsedSalePrice = parseEditablePrice(priceFormValues.sale_price, "sale_price");
      const parsedSalePriceX3 = priceFormValues.sale_price_x3 ? parseEditablePrice(priceFormValues.sale_price_x3, "sale_price_x3") : null;
      const parsedSalePriceX6 = priceFormValues.sale_price_x6 ? parseEditablePrice(priceFormValues.sale_price_x6, "sale_price_x6") : null;
      const parsedSalePriceX12 = priceFormValues.sale_price_x12 ? parseEditablePrice(priceFormValues.sale_price_x12, "sale_price_x12") : null;

      const nextPrices: Record<ProductPriceField, number | null> = {
        sale_price: parsedSalePrice ?? product.sale_price,
        sale_price_x3: parsedSalePriceX3,
        sale_price_x6: parsedSalePriceX6,
        sale_price_x12: parsedSalePriceX12,
      };

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

      toast.success(`Precios actualizados para ${product.name}`);
      setEditingPriceContext(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al guardar precio";
      toast.error(message);
    } finally {
      setIsSavingPrices(false);
    }
  };
  
  const handleDialogKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleCommitPrices();
    }
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
                    <th className="w-28 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      PVP Normal
                    </th>
                    <th className="w-24 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      PVP x3
                    </th>
                    <th className="w-24 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      PVP x6
                    </th>
                    <th className="w-24 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
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
                      return (
                        <button
                          type="button"
                          title={title}
                          onClick={(event) => handleStartEdit(event, product, field)}
                          className="inline-flex min-w-[76px] cursor-pointer justify-end rounded px-1 py-0.5 transition-colors hover:bg-indigo-50"
                        >
                          <span className="font-mono text-[12px] font-bold tabular-nums text-slate-900">
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
                        <td className="px-4 py-1.5 text-right align-middle">
                          {renderPriceCell("sale_price", "Editar precio normal")}
                        </td>
                        <td className="px-4 py-1.5 text-right align-middle">
                          {renderPriceCell("sale_price_x3", "Editar precio x3")}
                        </td>
                        <td className="px-4 py-1.5 text-right align-middle">
                          {renderPriceCell("sale_price_x6", "Editar precio x6")}
                        </td>
                        <td className="px-4 py-1.5 text-right align-middle">
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

      {/* Edit Prices Dialog (Ventanita) */}
      <Dialog open={!!editingPriceContext} onOpenChange={(open) => !open && setEditingPriceContext(null)}>
        <DialogContent className="sm:max-w-[400px] rounded-2xl p-0 overflow-hidden border-0 shadow-2xl bg-white">
          <div className="bg-slate-50 px-5 pt-6 pb-5 border-b border-slate-100 flex flex-col gap-1">
            <h3 className="text-lg font-bold text-slate-900 leading-tight">
              {editingPriceContext?.product.name}
            </h3>
            <p className="text-xs font-semibold text-slate-500 font-mono">
              SKU: {editingPriceContext?.product.sku || editingPriceContext?.product.barcode}
            </p>
          </div>
          
          <div className="px-5 py-5 space-y-4" onKeyDown={handleDialogKeyDown}>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit-field-sale_price" className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mb-1.5 block">PVP Normal ($)</Label>
                <Input
                  id="edit-field-sale_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceFormValues.sale_price}
                  onChange={(e) => setPriceFormValues(prev => ({...prev, sale_price: e.target.value}))}
                  className="font-mono font-bold text-sm bg-indigo-50 border-transparent focus-visible:bg-white focus-visible:ring-indigo-500/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div>
                <Label htmlFor="edit-field-sale_price_x3" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">PVP X3 ($)</Label>
                <Input
                  id="edit-field-sale_price_x3"
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceFormValues.sale_price_x3}
                  onChange={(e) => setPriceFormValues(prev => ({...prev, sale_price_x3: e.target.value}))}
                  className="font-mono font-bold text-sm bg-slate-50 border-transparent focus-visible:bg-white focus-visible:ring-slate-400/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div>
                <Label htmlFor="edit-field-sale_price_x6" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">PVP X6 ($)</Label>
                <Input
                  id="edit-field-sale_price_x6"
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceFormValues.sale_price_x6}
                  onChange={(e) => setPriceFormValues(prev => ({...prev, sale_price_x6: e.target.value}))}
                  className="font-mono font-bold text-sm bg-slate-50 border-transparent focus-visible:bg-white focus-visible:ring-slate-400/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div>
                <Label htmlFor="edit-field-sale_price_x12" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">PVP X12 ($)</Label>
                <Input
                  id="edit-field-sale_price_x12"
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceFormValues.sale_price_x12}
                  onChange={(e) => setPriceFormValues(prev => ({...prev, sale_price_x12: e.target.value}))}
                  className="font-mono font-bold text-sm bg-slate-50 border-transparent focus-visible:bg-white focus-visible:ring-slate-400/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>
          
          <div className="mt-auto border-t border-slate-100 bg-slate-50/50 p-4 flex items-center justify-between">
            <Button
              variant="ghost"
              className="text-slate-400 hover:text-slate-600 font-semibold"
              onClick={() => setEditingPriceContext(null)}
            >
              Cerrar
            </Button>
            <Button
              onClick={handleCommitPrices}
              disabled={isSavingPrices}
              className="px-6 bg-slate-900 border-0 text-white font-bold shadow-md shadow-slate-900/10 hover:bg-slate-800"
            >
              {isSavingPrices ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar Precios
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
