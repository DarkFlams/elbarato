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
import { getCatalogProducts } from "@/lib/local/catalog";
import { Input } from "@/components/ui/input";
import type { ProductWithOwner } from "@/types/database";

export function ProductSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductWithOwner[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { addItem } = useCart();

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await getCatalogProducts({
          search: query.trim(),
          limit: 8,
          offset: 0,
          stockFilter: "all",
        });

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
        description: `${product.owner.display_name} - $${product.sale_price.toFixed(2)}`,
      });
    }

    setQuery("");
    setResults([]);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && results.length === 1 && !isSearching) {
      event.preventDefault();
      handleSelect(results[0]);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar producto por nombre o codigo..."
          className="h-11 border-slate-200 bg-white pl-9 pr-8 shadow-sm transition-colors focus:border-indigo-500 focus:ring-indigo-500/20"
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
            <button
              key={product.id}
              onClick={() => handleSelect(product)}
              className="flex w-full items-center border-b border-slate-100 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 last:border-0"
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
                <p className="font-mono text-sm font-semibold">${product.sale_price.toFixed(2)}</p>
                <p className="text-xs text-slate-500">Stock: {product.stock}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && results.length === 0 && !isSearching && query.length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 shadow-lg">
          No se encontraron productos para "{query}"
        </div>
      )}
    </div>
  );
}
