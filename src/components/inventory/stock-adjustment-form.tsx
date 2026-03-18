/**
 * @file stock-adjustment-form.tsx
 * @description Formulario dedicado para registrar altas y bajas de stock.
 * Busca productos bajo demanda (server-side). Soporta pistola laser.
 * 
 * NOTE: La opcion "Ropa Vieja / Bodega" esta oculta temporalmente.
 * Ver docs/ropa-vieja.md y migration_bodega_remate.sql para reactivar.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PartnerEnum } from "@/types/database";
import { toast } from "sonner";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { playSuccessSound, playErrorSound } from "@/lib/audio";
import {
  getPartnerInitial,
  getPartnerVisual,
  getStockVisual,
} from "./inventory-ui";

type MovementOperation = "in" | "out";

interface ProductForAdjustment {
  id: string;
  name: string;
  barcode: string;
  sku: string | null;
  stock: number;
  min_stock: number;
  owner: {
    id: string;
    name: PartnerEnum;
    display_name: string;
    color_hex: string;
  } | null;
}

interface StockAdjustmentFormProps {
  onAdjusted?: () => void;
}

const PRODUCT_SELECT = `
  id, name, barcode, sku, stock, min_stock,
  owner:partners!products_owner_id_fkey (
    id, name, display_name, color_hex
  )
`;

export function StockAdjustmentForm({ onAdjusted }: StockAdjustmentFormProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductForAdjustment[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductForAdjustment | null>(null);
  const [operation, setOperation] = useState<MovementOperation>("in");
  const [quantity, setQuantity] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Debounced server-side search ──
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
        const safeTerm = query.trim().replace(/[,"]/g, " ");
        const { data, error } = await supabase
          .from("products")
          .select(PRODUCT_SELECT)
          .eq("is_active", true)
          .or(`name.ilike.%${safeTerm}%,barcode.ilike.%${safeTerm}%,sku.ilike.%${safeTerm}%`)
          .order("name")
          .limit(10);

        if (error) throw error;
        setResults((data as ProductForAdjustment[]) || []);
        setIsOpen(true);
      } catch (err) {
        console.error("[StockAdjustmentForm] search error:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // ── Close dropdown on outside click ──
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Select a product from the dropdown ──
  const handleSelect = (product: ProductForAdjustment) => {
    setSelectedProduct(product);
    setQuery("");
    setIsOpen(false);
    playSuccessSound();
    toast.success(`Producto seleccionado: ${product.name}`, {
      description: `Stock actual: ${product.stock}`,
    });
  };

  // ── Barcode scanner auto-select via laser ──
  const handleScan = useCallback(async (scannedCode: string) => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_SELECT)
        .eq("is_active", true)
        .or(`barcode.eq.${scannedCode},sku.eq.${scannedCode}`)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        playErrorSound();
        toast.error("Producto no encontrado", {
          description: `Codigo: ${scannedCode}`,
        });
        return;
      }

      const product = data as ProductForAdjustment;
      setSelectedProduct(product);
      playSuccessSound();
      toast.success(`Producto seleccionado: ${product.name}`, {
        description: `Stock actual: ${product.stock}`,
      });
    } catch (err) {
      console.error("[StockAdjustmentForm] scan error:", err);
      toast.error("Error al buscar producto");
    }
  }, []);

  useBarcodeScanner({ onScan: handleScan, enabled: true });

  // ── Refresh selected product after adjustment ──
  const refreshSelectedProduct = useCallback(async (productId: string) => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_SELECT)
        .eq("id", productId)
        .maybeSingle();
      if (!error && data) setSelectedProduct(data as ProductForAdjustment);
    } catch { /* keep old */ }
  }, []);

  const handleSubmit = async () => {
    if (!selectedProduct) {
      toast.error("Selecciona un producto");
      return;
    }

    const qty = parseInt(quantity || "1", 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Cantidad invalida");
      return;
    }

    if (operation === "out" && selectedProduct.stock < qty) {
      toast.error("Stock insuficiente para registrar la baja", {
        description: `Stock actual: ${selectedProduct.stock}`,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("adjust_product_stock", {
        p_product_id: selectedProduct.id,
        p_quantity: qty,
        p_operation: operation,
        p_reason: operation === "in" ? "restock" : "manual_adjustment",
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      const newStock = Number(row?.new_stock ?? 0);
      const delta = Number(row?.movement_delta ?? 0);

      toast.success(
        operation === "in" ? "Alta registrada" : "Baja registrada",
        {
          description: `${selectedProduct.name}: ${delta > 0 ? "+" : ""}${delta} | Nuevo stock: ${newStock}`,
        }
      );

      setQuantity("");
      await refreshSelectedProduct(selectedProduct.id);
      onAdjusted?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error inesperado";
      toast.error("No se pudo registrar el movimiento", { description: message });
      console.error("[StockAdjustmentForm] submit error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedStockVisual = selectedProduct
    ? getStockVisual(selectedProduct.stock, selectedProduct.min_stock)
    : null;
  const selectedOwnerVisual =
    selectedProduct?.owner ? getPartnerVisual(selectedProduct.owner.name) : null;

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Altas y bajas de inventario
          </h2>
          <p className="text-xs text-slate-500">
            Busca la prenda por nombre, codigo o barras. Tambien puedes
            escanear con la pistola laser.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          Alta = ingreso de unidades. Baja = salida manual o merma.
        </div>
      </div>

      {/* ── Inline search bar (like POS) ── */}
      <div ref={containerRef} className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto por nombre, codigo o barras..."
            className="pl-9 pr-8 h-11 bg-white border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/20 transition-colors shadow-sm"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setResults([]); setIsOpen(false); }}
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
                className="flex items-center w-full px-3 py-2.5 text-left hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-slate-900">{product.name}</p>
                  <p className="text-xs text-slate-500">
                    {product.owner && (
                      <>
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-1"
                          style={{ backgroundColor: product.owner.color_hex }}
                        />
                        {product.owner.display_name} —{" "}
                      </>
                    )}
                    {product.sku || product.barcode}
                  </p>
                </div>
                <div className="text-right ml-3">
                  <p className="text-xs text-slate-500">
                    Stock: <span className="font-semibold text-slate-700">{product.stock}</span>
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

      {/* ── Selected product info ── */}
      {selectedProduct && selectedStockVisual && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {selectedProduct.name}
                </p>
                <Badge
                  variant="outline"
                  className={cn("h-5 px-1.5 py-0 text-[10px]", selectedStockVisual.className)}
                >
                  {selectedStockVisual.label}
                </Badge>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-500">
                {selectedProduct.sku && `SKU: ${selectedProduct.sku} | `}{selectedProduct.barcode}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedProduct.owner && selectedOwnerVisual ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"
                  style={{
                    borderColor: selectedOwnerVisual.softBorder,
                    backgroundColor: selectedOwnerVisual.softBackground,
                    color: selectedOwnerVisual.softText,
                  }}
                >
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: selectedOwnerVisual.accent }}
                  >
                    {getPartnerInitial(selectedProduct.owner.display_name)}
                  </span>
                  {selectedProduct.owner.display_name}
                </span>
              ) : null}
              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
                Stock actual:{" "}
                <span className="font-semibold text-slate-900">{selectedProduct.stock}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Operation + Quantity ── */}
      <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <Label>Tipo de movimiento</Label>
          <div className="flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setOperation("in")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200",
                operation === "in"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-700"
              )}
            >
              <ArrowUpCircle className="h-4 w-4" />
              Alta
            </button>
            <button
              type="button"
              onClick={() => setOperation("out")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200",
                operation === "out"
                  ? "bg-white text-amber-700 shadow-sm"
                  : "text-slate-500 hover:bg-slate-200/50 hover:text-slate-700"
              )}
            >
              <ArrowDownCircle className="h-4 w-4" />
              Baja
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="adjust-qty">Cantidad</Label>
          <Input
            id="adjust-qty"
            type="number"
            min="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="Ej: 5"
            className="border-slate-200 bg-white font-mono shadow-sm focus-visible:border-slate-900 focus-visible:ring-slate-900/10"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || !selectedProduct}
          className={cn(
            "border-0 text-white shadow-md transition-all duration-200",
            operation === "in"
              ? "bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-700"
              : "bg-amber-600 shadow-amber-600/20 hover:bg-amber-700"
          )}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Registrando...
            </>
          ) : operation === "in" ? (
            <>
              <ArrowUpCircle className="mr-2 h-4 w-4" />
              Registrar alta
            </>
          ) : (
            <>
              <ArrowDownCircle className="mr-2 h-4 w-4" />
              Registrar baja
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
