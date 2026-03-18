/**
 * @file stock-adjustment-form.tsx
 * @description Formulario dedicado para registrar altas y bajas de stock.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Loader2, Search, Check, ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { PartnerEnum } from "@/types/database";
import { toast } from "sonner";
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

export function StockAdjustmentForm({ onAdjusted }: StockAdjustmentFormProps) {
  const [products, setProducts] = useState<ProductForAdjustment[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [operation, setOperation] = useState<MovementOperation>("in");
  const [quantity, setQuantity] = useState("1");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comboboxOpen, setComboboxOpen] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  const fetchProducts = useCallback(async () => {
    setIsLoadingProducts(true);
    try {
      const supabase = createClient();
      const PAGE_SIZE = 1000;
      let allProducts: ProductForAdjustment[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("products")
          .select(
            `
            id,
            name,
            barcode,
            stock,
            min_stock,
            owner:partners!products_owner_id_fkey (
              id, name, display_name, color_hex
            )
          `
          )
          .eq("is_active", true)
          .order("name", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        const batch = (data as ProductForAdjustment[]) || [];
        allProducts = allProducts.concat(batch);
        hasMore = batch.length === PAGE_SIZE;
        from += PAGE_SIZE;
      }

      setProducts(allProducts);
      setSelectedProductId((current) =>
        current || (allProducts.length > 0 ? allProducts[0].id : "")
      );
    } catch (err) {
      console.error("[StockAdjustmentForm] fetchProducts error:", err);
      toast.error("No se pudo cargar inventario");
    } finally {
      setIsLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleFindByBarcode = () => {
    const term = barcodeInput.trim().toLowerCase();
    if (!term) {
      toast.error("Ingresa un codigo de barras");
      return;
    }

    const found = products.find(
      (product) => product.barcode.toLowerCase() === term
    );

    if (!found) {
      toast.error("No se encontro producto con ese codigo");
      return;
    }

    setSelectedProductId(found.id);
    toast.success(`Producto seleccionado: ${found.name}`);
  };

  const handleSubmit = async () => {
    if (!selectedProduct) {
      toast.error("Selecciona un producto");
      return;
    }

    const qty = parseInt(quantity, 10);
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

      setQuantity("1");
      await fetchProducts();
      onAdjusted?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error inesperado";
      toast.error("No se pudo registrar el movimiento", {
        description: message,
      });
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
            Busca la prenda por codigo, confirma el stock actual y registra el
            movimiento sin entrar al formulario completo.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          Alta = ingreso de unidades. Baja = salida manual o merma.
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="adjust-barcode">Codigo de barras</Label>
          <Input
            id="adjust-barcode"
            value={barcodeInput}
            onChange={(event) => setBarcodeInput(event.target.value)}
            placeholder="Escanea o escribe el codigo"
            className="border-slate-200 bg-white font-mono shadow-sm focus-visible:border-slate-900 focus-visible:ring-slate-900/10"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleFindByBarcode();
              }
            }}
          />
        </div>
        <div className="self-end">
          <Button
            variant="outline"
            className="w-full border-slate-200 bg-white md:w-auto"
            onClick={handleFindByBarcode}
            disabled={isLoadingProducts || products.length === 0}
          >
            <Search className="mr-2 h-4 w-4" />
            Buscar
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Producto</Label>
        <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                role="combobox"
                className="w-full justify-between border-slate-200 bg-white text-left font-normal shadow-sm hover:bg-slate-50 focus-visible:border-slate-900 focus-visible:ring-slate-900/10"
                disabled={isLoadingProducts || products.length === 0}
              />
            }
          >
            <span className="truncate">
              {selectedProduct
                ? `${selectedProduct.name} (${selectedProduct.barcode})`
                : products.length === 0
                  ? "No hay productos activos"
                  : "Seleccionar producto..."}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Buscar por nombre o codigo..." className="h-9" />
              <CommandList>
                <CommandEmpty>No se encontraron productos.</CommandEmpty>
                <CommandGroup>
                  {products.map((product) => (
                    <CommandItem
                      key={product.id}
                      value={`${product.name} ${product.barcode}`}
                      onSelect={() => {
                        setSelectedProductId(product.id);
                        setComboboxOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedProductId === product.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex flex-1 items-center justify-between truncate">
                        <span className="truncate font-medium">{product.name}</span>
                        <span className="ml-2 shrink-0 font-mono text-xs text-slate-500">
                          {product.barcode} | Stock: {product.stock}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

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
                {selectedProduct.barcode}
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
                <span className="font-semibold text-slate-900">
                  {selectedProduct.stock}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

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
            placeholder="1"
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
