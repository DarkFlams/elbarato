/**
 * @file bodega/page.tsx
 * @description Pagina de Bodega — productos con unidades marcadas como ropa vieja.
 * Desde aquí se puede crear remate (vuelve al POS con precio rebajado)
 * o desechar (registro permanente, no vuelve).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Tag, Trash2, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getPartnerVisual,
} from "@/components/inventory/inventory-ui";
import type { PartnerEnum } from "@/types/database";

interface BodegaProduct {
  id: string;
  name: string;
  barcode: string;
  sku: string | null;
  sale_price: number;
  stock: number;
  bodega_stock: number;
  bodega_at: string | null;
  is_active: boolean;
  owner: {
    id: string;
    name: PartnerEnum;
    display_name: string;
    color_hex: string;
  } | null;
}

const BODEGA_SELECT = `
  id, name, barcode, sku, sale_price, stock, bodega_stock, bodega_at, is_active,
  owner:partners!products_owner_id_fkey (
    id, name, display_name, color_hex
  )
`;

function getAgingLabel(bodegaAt: string | null): { text: string; color: string } | null {
  if (!bodegaAt) return null;
  const days = Math.floor(
    (Date.now() - new Date(bodegaAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (days < 30) return { text: `${days}d`, color: "text-slate-500 bg-slate-100" };
  if (days < 90) {
    const months = Math.floor(days / 30);
    return { text: `${months} mes${months > 1 ? "es" : ""}`, color: "text-amber-700 bg-amber-50 border-amber-200" };
  }
  const months = Math.floor(days / 30);
  return { text: `${months} meses`, color: "text-red-700 bg-red-50 border-red-200" };
}

export default function BodegaPage() {
  const [products, setProducts] = useState<BodegaProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [remateModal, setRemateModal] = useState<BodegaProduct | null>(null);
  const [rematePrice, setRematePrice] = useState("");
  const [remateStock, setRemateStock] = useState("1");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDispose, setConfirmDispose] = useState<string | null>(null);

  const fetchBodega = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("products")
        .select(BODEGA_SELECT)
        .gt("bodega_stock", 0)
        .is("disposed_at", null)
        .order("bodega_at", { ascending: true, nullsFirst: false });

      if (error) throw error;
      setProducts((data as BodegaProduct[]) || []);
    } catch (err) {
      console.error("[BodegaPage] fetch error:", err);
      toast.error("Error al cargar bodega");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBodega();
  }, [fetchBodega]);

  // Filter locally
  const filteredProducts = search.length >= 2
    ? products.filter((p) => {
        const term = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(term) ||
          p.barcode.toLowerCase().includes(term) ||
          (p.sku && p.sku.toLowerCase().includes(term))
        );
      })
    : products;

  // ── Create remate ──
  const handleRemate = async () => {
    if (!remateModal) return;

    const price = parseFloat(rematePrice);
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("Ingresa un precio de remate valido");
      return;
    }

    const stock = parseInt(remateStock, 10);
    if (!Number.isFinite(stock) || stock <= 0) {
      toast.error("Ingresa un stock valido (minimo 1)");
      return;
    }

    if (stock > remateModal.bodega_stock) {
      toast.error(`Solo hay ${remateModal.bodega_stock} unidades en bodega`);
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("create_remate", {
        p_product_id: remateModal.id,
        p_clearance_price: price,
        p_stock: stock,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      toast.success(`🏷️ Remate creado: ${row?.product_name}`, {
        description: `$${row?.original_price} → $${price} | ${stock} unidades reingresadas`,
      });

      setRemateModal(null);
      setRematePrice("");
      setRemateStock("1");
      fetchBodega();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error";
      toast.error("No se pudo crear el remate", { description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Dispose product ──
  const handleDispose = async (productId: string) => {
    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("dispose_product", {
        p_product_id: productId,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      toast.success(`${row?.product_name} desechado`, {
        description: "El registro se conserva para auditoría",
      });

      setConfirmDispose(null);
      fetchBodega();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error";
      toast.error("No se pudo desechar", { description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Archive className="h-5 w-5 text-slate-700" />
          <h1 className="text-xl font-bold text-slate-900">Bodega</h1>
          <Badge variant="outline" className="ml-2 text-xs">
            {products.length} producto{products.length !== 1 ? "s" : ""}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Ropa vieja retirada del inventario. Desde aqui puedes crear remates o desechar.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar en bodega..."
          className="pl-9 pr-8 h-10 bg-white border-slate-200"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Cargando bodega...
        </div>
      )}

      {/* Empty */}
      {!loading && products.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Archive className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm font-medium">La bodega esta vacia</p>
          <p className="text-xs mt-1">Los productos marcados como ropa vieja apareceran aqui</p>
        </div>
      )}

      {/* Product list */}
      {!loading && filteredProducts.length > 0 && (
        <div className="space-y-3">
          {filteredProducts.map((product) => {
            const aging = getAgingLabel(product.bodega_at);
            const ownerVisual = product.owner
              ? getPartnerVisual(product.owner.name)
              : null;

            return (
              <div
                key={product.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between"
              >
                {/* Product info */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {product.name}
                    </p>
                    <Badge
                      variant="outline"
                      className="h-5 px-1.5 py-0 text-[10px] border border-red-200 bg-red-50 text-red-700"
                    >
                      {product.bodega_stock} en bodega
                    </Badge>
                    {product.is_active && (
                      <Badge
                        variant="outline"
                        className="h-5 px-1.5 py-0 text-[10px] border border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        {product.stock} activas
                      </Badge>
                    )}
                    {aging && (
                      <Badge
                        variant="outline"
                        className={cn("h-5 px-1.5 py-0 text-[10px] border", aging.color)}
                      >
                        {aging.text}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="font-mono">
                      {product.sku && `${product.sku} | `}{product.barcode}
                    </span>
                    <span>Precio original: <span className="font-semibold text-slate-700">${product.sale_price.toFixed(2)}</span></span>
                    {product.owner && ownerVisual && (
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: ownerVisual.accent }}
                        />
                        {product.owner.display_name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => {
                      setRemateModal(product);
                      setRematePrice(String((product.sale_price * 0.5).toFixed(2)));
                      setRemateStock(String(product.bodega_stock));
                    }}
                    className="bg-amber-500 text-white hover:bg-amber-600 shadow-sm"
                  >
                    <Tag className="mr-1.5 h-3.5 w-3.5" />
                    Remate
                  </Button>

                  {confirmDispose === product.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDispose(null)}
                        className="text-slate-500 h-8"
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleDispose(product.id)}
                        disabled={isSubmitting}
                        className="bg-red-600 text-white hover:bg-red-700 h-8"
                      >
                        {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirmar"}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmDispose(product.id)}
                      className="border-red-200 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Desechar
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Remate modal (inline) ── */}
      {remateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100">
                <Tag className="h-4 w-4 text-amber-700" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">
                Crear remate
              </h3>
            </div>

            <p className="text-sm text-slate-600 mb-4">
              <span className="font-medium">{remateModal.name}</span> volvera al inventario y al Punto de Venta con el precio de remate.
            </p>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-500">Precio original</span>
                <span className="font-semibold text-slate-900">${remateModal.sale_price.toFixed(2)}</span>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm">
                <span className="text-red-600">En bodega</span>
                <span className="font-semibold text-red-700">{remateModal.bodega_stock} unidades</span>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="remate-price">Precio de remate *</Label>
                <Input
                  id="remate-price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={rematePrice}
                  onChange={(e) => setRematePrice(e.target.value)}
                  className="font-mono border-amber-200 focus-visible:border-amber-500 focus-visible:ring-amber-500/20"
                />
                <p className="text-[11px] text-slate-400">
                  Sugerido: 50% = ${(remateModal.sale_price * 0.5).toFixed(2)}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="remate-stock">Unidades a reingresar (max {remateModal.bodega_stock})</Label>
                <Input
                  id="remate-stock"
                  type="number"
                  min="1"
                  max={remateModal.bodega_stock}
                  value={remateStock}
                  onChange={(e) => setRemateStock(e.target.value)}
                  className="font-mono border-slate-200"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => { setRemateModal(null); setRematePrice(""); }}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleRemate}
                disabled={isSubmitting}
                className="bg-amber-500 text-white hover:bg-amber-600"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creando...
                  </>
                ) : (
                  <>
                    <Tag className="mr-2 h-4 w-4" />
                    Crear remate
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
