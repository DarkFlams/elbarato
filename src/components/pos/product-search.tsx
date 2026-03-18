/**
 * @file product-search.tsx
 * @description Busqueda manual de productos por nombre o codigo de barras.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useCart } from "@/hooks/use-cart";
import type { ProductWithOwner } from "@/types/database";
import { toast } from "sonner";
import { playSuccessSound } from "@/lib/audio";

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

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("products")
          .select(
            `
            *,
            owner:partners!products_owner_id_fkey (
              id, name, display_name, color_hex
            )
          `
          )
          .eq("is_active", true)
          .or(`name.ilike.%${query}%,barcode.ilike.%${query}%,sku.ilike.%${query}%`)
          .order("name")
          .limit(8);

        if (error) throw error;

        setResults((data as unknown as ProductWithOwner[]) || []);
        setIsOpen(true);
      } catch (err) {
        console.error("[ProductSearch] search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (product: ProductWithOwner) => {
    if (product.stock <= 0) {
      toast.error(`${product.name} sin stock`, {
        description: "No se puede agregar al carrito",
      });
      return;
    }

    const result = addItem(product);
    if (!result.ok) {
      toast.warning(`No puedes agregar mas de ${product.name}`, {
        description: `Stock disponible: ${result.availableStock ?? product.stock}`,
      });
      return;
    }

    playSuccessSound();
    // NOTE: clearance_price/REMATE logic hidden. See docs/ropa-vieja.md
    toast.success(`${product.name} agregado`, {
      description: `${product.owner.display_name} - $${product.sale_price.toFixed(2)}`,
    });
    setQuery("");
    setIsOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto por nombre o codigo..."
          className="pl-9 pr-8 h-11 bg-white border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 transition-colors shadow-sm"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              setIsOpen(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
          {results.map((product) => (
            <button
              key={product.id}
              onClick={() => handleSelect(product)}
              disabled={product.stock <= 0}
              className="flex items-center w-full px-3 py-2.5 text-left hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-slate-900">{product.name}</p>
                <p className="text-xs text-slate-500">
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1"
                    style={{ backgroundColor: product.owner.color_hex }}
                  />
                  {product.owner.display_name} - {product.barcode}
                  {product.stock <= 0 && (
                    <span className="ml-2 text-red-400">Sin stock</span>
                  )}
                  {product.stock > 0 && product.stock <= product.min_stock && (
                    <span className="ml-2 text-yellow-400">
                      Stock: {product.stock}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right ml-3">
                <p className="font-mono text-sm font-semibold">
                  ${product.sale_price.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500">
                  Stock: {product.stock}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && results.length === 0 && !isSearching && query.length >= 2 && (
        <div className="absolute z-50 w-full mt-1 rounded-lg border border-slate-200 bg-white shadow-lg p-4 text-center text-sm text-slate-500">
          No se encontraron productos para &quot;{query}&quot;
        </div>
      )}
    </div>
  );
}
