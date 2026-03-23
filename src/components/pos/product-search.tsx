/**
 * @file product-search.tsx
 * @description Busqueda manual de productos por nombre o codigo.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { playSuccessSound } from "@/lib/audio";
import { useCart } from "@/hooks/use-cart";
import { getPriceForTier, getTierLabel } from "@/lib/pricing";
import {
  findCatalogProductByBarcode,
  searchCatalogProductsByIntent,
} from "@/lib/local/catalog";
import { getPartnerVisual } from "@/components/inventory/inventory-ui";
import { Input } from "@/components/ui/input";
import type { ProductWithOwner } from "@/types/database";

function normalizeCodeKey(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findExactCodeMatch(products: ProductWithOwner[], query: string) {
  const normalizedQuery = normalizeCodeKey(query);
  if (!normalizedQuery) return null;

  return (
    products.find(
      (product) =>
        normalizeCodeKey(product.barcode) === normalizedQuery ||
        normalizeCodeKey(product.sku) === normalizedQuery
    ) ?? null
  );
}

function shouldTryExactCodeLookup(value: string) {
  const searchTerm = value.trim();
  if (!searchTerm || /\s/.test(searchTerm)) return false;
  if (searchTerm.length < 2 || searchTerm.length > 32) return false;
  return /\d/.test(searchTerm);
}

function formatStockLabel(stock: number) {
  if (stock <= 0) return "0";
  if (Number.isInteger(stock)) return String(stock);
  return stock.toFixed(2);
}

export function ProductSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductWithOwner[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const { addItem, selectedPriceTier } = useCart();

  const searchProducts = async (
    rawQuery: string,
    limit: number
  ): Promise<ProductWithOwner[]> => {
    const searchTerm = rawQuery.trim();
    if (!searchTerm) return [];

    return searchCatalogProductsByIntent({
      search: searchTerm,
      limit,
      offset: 0,
      stockFilter: "all",
    });
  };

  const resetSearch = () => {
    setQuery("");
    setResults([]);
    setIsOpen(false);
    setSelectedIndex(0);
  };

  const focusResult = (index: number) => {
    window.requestAnimationFrame(() => {
      resultRefs.current[index]?.scrollIntoView({ block: "nearest" });
    });
  };

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      setSelectedIndex(0);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await searchProducts(query, 24);
        setResults(data);
        setIsOpen(true);
        setSelectedIndex(0);
      } catch (error) {
        console.error("[ProductSearch] search error:", error);
      } finally {
        setIsSearching(false);
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    resultRefs.current = resultRefs.current.slice(0, results.length);
  }, [results]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setSelectedIndex(0);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (product: ProductWithOwner) => {
    const result = addItem(product);
    if (!result.ok) {
      if (result.reason === "price_tier_unavailable") {
        toast.error(`${product.name} no tiene precio ${getTierLabel(selectedPriceTier)}`, {
          description: "Selecciona otro tier o completa la lista de precios.",
        });
        return;
      }

      toast.warning(`No puedes agregar mas de ${product.name}`, {
        description: `Error: ${result.reason}`,
      });
      return;
    }

    playSuccessSound();

    if (product.stock <= 0) {
      toast.warning(`${product.name} agregado sin stock`, {
        description: `${product.owner.display_name} - Se vendera en negativo.`,
      });
    } else {
      toast.success(`${product.name} agregado`, {
        description: `${product.owner.display_name} - $${(
          result.appliedPrice ?? product.sale_price
        ).toFixed(2)} - ${getTierLabel(result.appliedTier ?? selectedPriceTier)}`,
      });
    }

    resetSearch();
    inputRef.current?.blur();
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setSelectedIndex((current) => {
        const nextIndex = Math.min(current + 1, results.length - 1);
        focusResult(nextIndex);
        return nextIndex;
      });
      return;
    }

    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setSelectedIndex((current) => {
        const nextIndex = Math.max(current - 1, 0);
        focusResult(nextIndex);
        return nextIndex;
      });
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
      setSelectedIndex(0);
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    const searchTerm = query.trim();
    if (!searchTerm) return;

    if (isOpen && results[selectedIndex]) {
      handleSelect(results[selectedIndex]);
      return;
    }

    const exactResult = findExactCodeMatch(results, searchTerm);
    if (exactResult) {
      handleSelect(exactResult);
      return;
    }

    if (shouldTryExactCodeLookup(searchTerm)) {
      try {
        const exactByCode = await findCatalogProductByBarcode(searchTerm);
        if (exactByCode) {
          handleSelect(exactByCode);
          return;
        }
      } catch (error) {
        console.error("[ProductSearch] exact code lookup error:", error);
      }
    }

    if (!isSearching && results.length > 0) {
      handleSelect(results[0]);
      return;
    }

    setIsSearching(true);
    try {
      const data = await searchProducts(searchTerm, 24);

      if (data.length > 0) {
        handleSelect(data[0]);
      } else {
        toast.error(`No se encontro ningun producto para: ${searchTerm}`);
      }
    } catch (error) {
      console.error("[ProductSearch] instant search error:", error);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          ref={inputRef}
          id="pos-product-search-input"
          name="pos-product-search"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim().length >= 2 && results.length > 0) {
              setIsOpen(true);
            }
          }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Buscar producto por nombre o codigo..."
          className="h-9 border-slate-200 bg-white pl-9 pr-8 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:ring-indigo-500/20"
        />

        {query && !isSearching && (
          <button
            onClick={resetSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-[300px] w-full overflow-y-auto overflow-x-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="sticky top-0 z-10 grid grid-cols-[74px_minmax(0,1fr)_74px_90px] items-center gap-3 border-b border-slate-200 bg-slate-50 pl-5 pr-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <span className="border-r border-slate-200 pr-3">PVP</span>
            <span className="border-r border-slate-200 pr-3">Producto</span>
            <span className="border-r border-slate-200 pr-3 text-right">Stock</span>
            <span className="text-right">Codigo</span>
          </div>
          {results.map((product, index) => {
            const tierPrice = getPriceForTier(product, selectedPriceTier);
            const tierUnavailable =
              tierPrice === null || tierPrice === undefined || tierPrice <= 0;
            const isSelected = index === selectedIndex;
            const visual = getPartnerVisual(product.owner.name);

            return (
              <button
                key={product.id}
                ref={(element) => {
                  resultRefs.current[index] = element;
                }}
                onClick={() => handleSelect(product)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`relative grid w-full grid-cols-[74px_minmax(0,1fr)_74px_90px] items-center gap-3 border-b border-slate-100 pl-5 pr-3 py-1 text-left transition-colors last:border-0 ${
                  isSelected ? "bg-slate-100" : "hover:bg-slate-50"
                }`}
              >
                <div
                  className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r-md"
                  style={{ backgroundColor: visual.accent }}
                />
                <div className="border-r border-slate-100 pr-3 font-mono text-[13px] font-semibold tabular-nums text-slate-900">
                  {tierUnavailable ? "--" : tierPrice.toFixed(2)}
                </div>

                <div className="min-w-0 truncate border-r border-slate-100 pr-3 text-[13px] font-semibold leading-tight text-slate-900">
                  {product.name}
                </div>

                <div
                  className={`border-r border-slate-100 pr-3 text-right font-mono text-[13px] font-semibold tabular-nums ${
                    product.stock <= 0
                      ? "text-rose-600"
                      : product.stock <= product.min_stock
                      ? "text-amber-600"
                      : "text-slate-900"
                  }`}
                >
                  {formatStockLabel(product.stock)}
                </div>

                <div className="truncate text-right font-mono text-[13px] font-semibold text-slate-700">
                  {product.sku || product.barcode}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {isOpen && results.length === 0 && !isSearching && query.length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 shadow-lg">
          No se encontraron productos para &quot;{query}&quot;
        </div>
      )}
    </div>
  );
}
