/**
 * @file product-form.tsx
 * @description Modal para crear o editar productos de inventario.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Package, Plus, Save, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  generateCatalogBarcode,
  getCatalogProducts,
  saveCatalogProduct,
} from "@/lib/local/catalog";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Partner, Product } from "@/types/database";
import { getPartnerInitial, getPartnerVisual } from "./inventory-ui";

interface ProductFormProps {
  partners: Partner[];
  product?: Product | null;
  onSaved?: () => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showDefaultTrigger?: boolean;
}

async function generateUniqueBarcode(): Promise<string> {
  return generateCatalogBarcode();
}

async function isSkuTaken(skuValue: string, excludeProductId?: string): Promise<boolean> {
  const products = await getCatalogProducts({
    search: skuValue,
    limit: 250,
    offset: 0,
  });

  return products.some((current) => {
    if (!current.sku || current.sku !== skuValue) {
      return false;
    }

    if (excludeProductId && current.id === excludeProductId) {
      return false;
    }

    return true;
  });
}

async function upsertProductRemote(input: {
  productId?: string | null;
  barcode: string;
  sku?: string | null;
  name: string;
  description?: string | null;
  ownerId: string;
  salePrice: number;
  salePriceX3?: number | null;
  salePriceX6?: number | null;
  salePriceX12?: number | null;
  stock: number;
  minStock: number;
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("upsert_product_with_movement", {
    p_product_id: input.productId ?? null,
    p_barcode: input.barcode,
    p_name: input.name.trim(),
    p_description: null, // Ya no usamos descripciones autogeneradas de tallas
    p_category: null,
    p_owner_id: input.ownerId,
    p_purchase_price: 0,
    p_sale_price: input.salePrice,
    p_sale_price_x3: input.salePriceX3 ?? null,
    p_sale_price_x6: input.salePriceX6 ?? null,
    p_sale_price_x12: input.salePriceX12 ?? null,
    p_stock: input.stock,
    p_min_stock: input.minStock,
    p_is_active: true,
    p_sku: input.sku || null,
  });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
}

export function ProductForm({
  partners,
  product,
  onSaved,
  trigger,
  open: controlledOpen,
  onOpenChange,
  showDefaultTrigger = true,
}: ProductFormProps) {
  const isEditing = !!product;
  const [internalOpen, setInternalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [salePrice, setSalePrice] = useState("");
  const [salePriceX3, setSalePriceX3] = useState("");
  const [salePriceX6, setSalePriceX6] = useState("");
  const [salePriceX12, setSalePriceX12] = useState("");
  const [stock, setStock] = useState("");
  const [minStock, setMinStock] = useState("2");
  
  // UX State
  const [showWholesale, setShowWholesale] = useState(false);

  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange]
  );

  useEffect(() => {
    if (product && open) {
      setBarcode(product.barcode);
      setSku(product.sku || "");
      setName(product.name);
      setOwnerId(product.owner_id);
      setSalePrice(String(product.sale_price));
      setSalePriceX3(product.sale_price_x3 !== null ? String(product.sale_price_x3) : "");
      setSalePriceX6(product.sale_price_x6 !== null ? String(product.sale_price_x6) : "");
      setSalePriceX12(product.sale_price_x12 !== null ? String(product.sale_price_x12) : "");
      setStock(String(product.stock));
      setMinStock(String(product.min_stock));
      
      // Auto-expandir precios al por mayor si la prenda ya tiene configurado alguno
      if (product.sale_price_x3 || product.sale_price_x6 || product.sale_price_x12) {
        setShowWholesale(true);
      } else {
        setShowWholesale(false);
      }
      return;
    }

    if (!product && open) {
      resetForm();
    }
  }, [open, product]);

  const resetForm = () => {
    setBarcode("");
    setSku("");
    setName("");
    setOwnerId("");
    setSalePrice("");
    setSalePriceX3("");
    setSalePriceX6("");
    setSalePriceX12("");
    setStock("");
    setMinStock("2");
    setShowWholesale(false);
  };

  const parseOptionalPrice = (raw: string, label: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const parsed = parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Revisa el ${label}`);
    }

    return parsed;
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Falta el nombre de la prenda");
      return;
    }

    if (!ownerId) {
      toast.error("Selecciona la dueña");
      return;
    }

    if (!salePrice || parseFloat(salePrice) <= 0) {
      toast.error("Falta el precio base");
      return;
    }

    setIsSubmitting(true);

    try {
      const trimmedSku = sku.trim();
      if (trimmedSku) {
        const taken = await isSkuTaken(trimmedSku, isEditing && product ? product.id : undefined);
        if (taken) {
          toast.error("Ese SKU ya existe", {
            description: `El código "${trimmedSku}" ya lo tiene otra prenda.`,
          });
          setIsSubmitting(false);
          return;
        }
      }

      const parsedSalePrice = parseFloat(salePrice);
      const parsedSalePriceX3 = parseOptionalPrice(salePriceX3, "precio x3");
      const parsedSalePriceX6 = parseOptionalPrice(salePriceX6, "precio x6");
      const parsedSalePriceX12 = parseOptionalPrice(salePriceX12, "precio x12");
      const parsedStock = parseInt(stock, 10) || 0;
      const parsedMinStock = parseInt(minStock, 10) || 0;
      const finalBarcode = isEditing ? barcode : await generateUniqueBarcode();

      const result = await saveCatalogProduct({
        productId: isEditing && product ? product.id : null,
        remoteId: product?.id ?? null,
        barcode: finalBarcode,
        sku: trimmedSku || null,
        name: name.trim(),
        description: null,
        category: null,
        ownerId,
        purchasePrice: 0,
        salePrice: parsedSalePrice,
        salePriceX3: parsedSalePriceX3,
        salePriceX6: parsedSalePriceX6,
        salePriceX12: parsedSalePriceX12,
        stock: parsedStock,
        minStock: parsedMinStock,
        isActive: true,
      }).catch(async (localError) => {
        console.warn("[ProductForm] local save failed, using remote fallback", localError);
        return upsertProductRemote({
          productId: isEditing && product ? product.id : null,
          barcode: finalBarcode,
          sku: trimmedSku || null,
          name: name.trim(),
          description: null,
          ownerId,
          salePrice: parsedSalePrice,
          salePriceX3: parsedSalePriceX3,
          salePriceX6: parsedSalePriceX6,
          salePriceX12: parsedSalePriceX12,
          stock: parsedStock,
          minStock: parsedMinStock,
        });
      });

      const movementDelta = Number(result?.movement_delta || result?.movementDelta || 0);

      toast.success(isEditing ? "Prenda actualizada" : "Prenda creada", {
        description: isEditing
          ? (movementDelta !== 0 ? `Ajuste de stock: ${movementDelta > 0 ? "+" : ""}${movementDelta}` : "Los datos se guardaron.")
          : `SKU: ${trimmedSku || finalBarcode} | Ingreso: ${movementDelta}`,
      });

      resetForm();
      setOpen(false);
      onSaved?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al guardar";
      toast.error("Error al guardar", { description: message });
      console.error("[ProductForm] submit error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keyboard navigation helper for seamless fluid input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, nextId?: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (nextId) {
        document.getElementById(nextId)?.focus();
      } else {
        handleSubmit();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger as React.ReactElement} />
      ) : showDefaultTrigger ? (
        <DialogTrigger
          render={
            <Button className="border-0 bg-slate-900 text-white shadow-md shadow-slate-900/10 transition-all duration-200 hover:bg-slate-800" />
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          Nueva Prenda
        </DialogTrigger>
      ) : null}

      <DialogContent className="max-h-[90vh] overflow-y-auto bg-white shadow-2xl sm:max-w-[480px] p-0 border-0 rounded-2xl">
        <div className="flex flex-col h-full">
          
          {/* Cabecera Clásica Estilizada */}
          <div className="bg-slate-50 px-6 pt-8 pb-6 border-b border-slate-100 flex flex-col gap-4">
            {!isEditing && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">
                <ScanLine className="h-3.5 w-3.5" />
                <span className="opacity-90">BARRAS AUTOMÁTICO</span>
              </div>
            )}
            
            <div className="relative group w-full">
              <span className="absolute -top-2 left-2 bg-slate-50 px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider z-10 transition-colors group-focus-within:text-indigo-500">Nombre de la Prenda</span>
              <Input
                id="field-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, "field-sku")}
                className="bg-white border-slate-200 shadow-sm focus-visible:border-indigo-400 focus-visible:ring-indigo-400/20 h-11 placeholder:text-transparent text-slate-900 font-medium"
                placeholder="Nombre"
                autoComplete="off"
              />
            </div>
            
            <div className="flex items-center gap-4 mt-1">
              <div className="relative group flex-1">
                <span className="absolute -top-2 left-2 bg-slate-50 px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider z-10 transition-colors group-focus-within:text-indigo-500">CÓDIGO</span>
                <Input
                  id="field-sku"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, "field-price")}
                  className="font-mono bg-white border-slate-200 shadow-sm focus-visible:border-indigo-400 focus-visible:ring-indigo-400/20 h-11 placeholder:text-transparent"
                  placeholder="Código"
                  autoComplete="off"
                />
              </div>

              {isEditing && (
                <div className="relative flex-1">
                  <span className="absolute -top-2 left-2 bg-slate-50 px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider z-10">BARRAS</span>
                  <Input
                    value={barcode}
                    readOnly
                    className="font-mono bg-slate-100 border-transparent text-slate-500 shadow-none cursor-not-allowed h-11"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-6 space-y-8">
            
            {/* Fila Principal: Precio y Stock */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="field-price" className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Precio ($)</Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">$</span>
                  <Input
                    id="field-price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, "field-stock")}
                    className="pl-8 text-xl font-bold h-12 bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-emerald-400 focus-visible:ring-emerald-400/20 tabular-nums placeholder:text-transparent"
                    placeholder="0"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="field-stock" className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Stock Físico</Label>
                <Input
                  id="field-stock"
                  type="number"
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e)}
                  className="text-xl font-bold h-12 bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-amber-400 focus-visible:ring-amber-400/20 tabular-nums placeholder:text-transparent"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Socia Owners (Pills) */}
            <div>
              <Label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">Dueña de la Prenda</Label>
              <div className="flex flex-wrap gap-2">
                {partners.map((partner) => {
                  const visual = getPartnerVisual(partner.name);
                  const isSelected = ownerId === partner.id;

                  return (
                    <button
                      key={partner.id}
                      type="button"
                      onClick={() => setOwnerId(partner.id)}
                      className={cn(
                        "rounded-full px-4 py-2 text-sm font-semibold transition-all border outline-none focus-visible:ring-2 focus-visible:ring-offset-1 select-none flex items-center gap-2",
                        isSelected
                          ? "shadow-sm"
                          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:border-slate-300"
                      )}
                      style={
                        isSelected
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
            </div>

            {/* Progressive Disclosure: Precios por Mayor */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowWholesale(!showWholesale)}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 select-none flex items-center transition-opacity"
              >
                {showWholesale ? "Ocultar precios extras" : "+ Añadir precios al por mayor"}
              </button>

              {showWholesale && (
                <div className="mt-4 grid grid-cols-3 gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div>
                    <Label htmlFor="field-x3" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">X3 ($)</Label>
                    <Input
                      id="field-x3"
                      type="number"
                      step="0.01"
                      min="0"
                      value={salePriceX3}
                      onChange={(e) => setSalePriceX3(e.target.value)}
                      className="h-10 text-sm font-mono bg-slate-50 border-transparent focus-visible:bg-white placeholder:text-transparent"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="field-x6" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">X6 ($)</Label>
                    <Input
                      id="field-x6"
                      type="number"
                      step="0.01"
                      min="0"
                      value={salePriceX6}
                      onChange={(e) => setSalePriceX6(e.target.value)}
                      className="h-10 text-sm font-mono bg-slate-50 border-transparent focus-visible:bg-white placeholder:text-transparent"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label htmlFor="field-x12" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">X12 ($)</Label>
                    <Input
                      id="field-x12"
                      type="number"
                      step="0.01"
                      min="0"
                      value={salePriceX12}
                      onChange={(e) => setSalePriceX12(e.target.value)}
                      className="h-10 text-sm font-mono bg-slate-50 border-transparent focus-visible:bg-white placeholder:text-transparent"
                      placeholder="0"
                    />
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Footer Clean */}
          <div className="mt-auto border-t border-slate-100 bg-slate-50/50 p-6 flex items-center justify-between">
            <Button
              variant="ghost"
              className="text-slate-400 hover:text-slate-600 font-semibold"
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
            >
              Cerrar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-8 bg-slate-900 border-0 text-white font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 hover:-translate-y-0.5 transition-all duration-200"
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {isEditing ? "Actualizar" : "Guardar Prenda"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
