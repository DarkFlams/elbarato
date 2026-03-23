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

export function ProductSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductWithOwner[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await searchProducts(query, 8);

        setResults(data);
        setIsOpen(true);
      } catch (error) {
        console.error("[ProductSearch] search error:", error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
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

    setQuery("");
    setResults([]);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      
      const searchTerm = query.trim();
      if (!searchTerm) return;

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
      } else {
        setIsSearching(true);
        try {
          const data = await searchProducts(searchTerm, 8);
          
          if (data.length > 0) {
            handleSelect(data[0]);
          } else {
            toast.error(`No se encontró ningún producto para: ${searchTerm}`);
          }
        } catch (error) {
          console.error("[ProductSearch] instant search error:", error);
        } finally {
          setIsSearching(false);
        }
      }
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
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Buscar producto por nombre o codigo..."
          className="h-9 border-slate-200 bg-white pl-9 pr-8 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:ring-indigo-500/20"
        />

        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              setIsOpen(false);
            }}
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
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((product) => (
            (() => {
              const tierPrice = getPriceForTier(product, selectedPriceTier);
              const tierUnavailable =
                tierPrice === null || tierPrice === undefined || tierPrice <= 0;

              return (
                <button
                  key={product.id}
                  onClick={() => handleSelect(product)}
                  className="flex w-full items-center border-b border-slate-100 px-3 py-2 text-left transition-colors hover:bg-slate-50 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{product.name}</p>
                    <p className="text-xs text-slate-500">
                      <span
                        className="mr-1 inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: product.owner.color_hex }}
                      />
                      {product.owner.display_name} - {product.barcode}
                      {product.stock <= 0 && (
                        <span className="ml-2 text-red-400">Sin stock</span>
                      )}
                      {product.stock > 0 && product.stock <= product.min_stock && (
                        <span className="ml-2 text-yellow-500">Stock: {product.stock}</span>
                      )}
                    </p>
                  </div>

                  <div className="ml-3 text-right">
                    <p className="font-mono text-sm font-semibold">
                      {tierUnavailable ? "--" : `$${tierPrice.toFixed(2)}`}
                    </p>
                    <p className="text-xs text-slate-500">
                      {getTierLabel(selectedPriceTier)}
                    </p>
                  </div>
                </button>
              );
            })()
          ))}
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

