/**
 * @file product-form.tsx
 * @description Modal para crear o editar productos de inventario.
 */

"use client";

import { useState, useEffect } from "react";
import { Plus, Save, Loader2, Package, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import type { Partner, Product } from "@/types/database";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getPartnerInitial,
  getPartnerVisual,
} from "./inventory-ui";

interface ProductFormProps {
  partners: Partner[];
  product?: Product | null;
  onSaved?: () => void;
  trigger?: React.ReactNode;
}

const SIZE_SPLIT_REGEX = /[\s,;/|]+/g;

async function generateUniqueBarcode(): Promise<string> {
  const supabase = createClient();
  // Find the highest ELB- barcode to continue the sequence
  const { data } = await supabase
    .from("products")
    .select("barcode")
    .ilike("barcode", "ELB-%")
    .order("barcode", { ascending: false })
    .limit(1);

  let nextNum = 1;
  if (data && data.length > 0) {
    const match = data[0].barcode.match(/ELB-(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }

  // Also check total count to avoid any gap collision
  const { count } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true });

  if (count && count >= nextNum) nextNum = count + 1;

  return `ELB-${String(nextNum).padStart(5, "0")}`;
}

async function isSkuTaken(skuValue: string, excludeProductId?: string): Promise<boolean> {
  const supabase = createClient();
  let q = supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("sku", skuValue);

  if (excludeProductId) {
    q = q.neq("id", excludeProductId);
  }

  const { count } = await q;
  return (count ?? 0) > 0;
}

function normalizeSizeToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";

  if (/^[a-zA-Z]+$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return trimmed;
}

function parseSizesInput(raw: string): string[] {
  const unique = new Set<string>();
  const tokens = raw
    .split(SIZE_SPLIT_REGEX)
    .map((token) => normalizeSizeToken(token))
    .filter(Boolean);

  for (const token of tokens) {
    unique.add(token);
  }

  return Array.from(unique);
}

function parseSizesFromDescription(raw: string | null): string[] {
  if (!raw) return [];

  const sizesMatch = raw.match(/Tallas:\s*([^|]+)/i);
  const source = sizesMatch?.[1] ?? raw;
  return parseSizesInput(source.replace(/,/g, " "));
}

export function ProductForm({
  partners,
  product,
  onSaved,
  trigger,
}: ProductFormProps) {
  const isEditing = !!product;
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [sizesText, setSizesText] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [salePrice, setSalePrice] = useState("");
  const [stock, setStock] = useState("");
  const [minStock, setMinStock] = useState("2");

  useEffect(() => {
    if (product && open) {
      const parsedSizes = parseSizesFromDescription(product.description);
      setBarcode(product.barcode);
      setSku(product.sku || "");
      setName(product.name);
      setOwnerId(product.owner_id);
      setSalePrice(String(product.sale_price));
      setStock(String(product.stock));
      setMinStock(String(product.min_stock));
      setSizesText(parsedSizes.join(" ")); // keep for backward compat
    } else if (!product && open) {
      resetForm();
    }
  }, [product, open]);

  const resetForm = () => {
    setBarcode("");
    setSku("");
    setName("");
    setSizesText("");
    setOwnerId("");
    setSalePrice("");
    setStock("");
    setMinStock("2");
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Ingresa el nombre de la prenda");
      return;
    }

    const parsedSizes = parseSizesInput(sizesText);

    if (!ownerId) {
      toast.error("Selecciona la socia duena");
      return;
    }

    if (!salePrice || parseFloat(salePrice) <= 0) {
      toast.error("Ingresa un precio de venta valido");
      return;
    }

    setIsSubmitting(true);

    try {
      // Validate SKU uniqueness if provided
      const trimmedSku = sku.trim();
      if (trimmedSku) {
        const taken = await isSkuTaken(trimmedSku, isEditing && product ? product.id : undefined);
        if (taken) {
          toast.error("Ese SKU ya existe", {
            description: `El codigo "${trimmedSku}" ya esta asignado a otro producto.`,
          });
          setIsSubmitting(false);
          return;
        }
      }

      const supabase = createClient();
      const nextStock = parseInt(stock, 10) || 0;
      // For new products, auto-generate. For editing, keep existing.
      const finalBarcode = isEditing ? barcode : await generateUniqueBarcode();
      const finalDescription = parsedSizes.length > 0 ? `Tallas: ${parsedSizes.join(", ")}` : null;

      const { data, error } = await supabase.rpc("upsert_product_with_movement", {
        p_product_id: isEditing && product ? product.id : null,
        p_barcode: finalBarcode,
        p_name: name.trim(),
        p_description: finalDescription,
        p_category: null,
        p_owner_id: ownerId,
        p_purchase_price: 0,
        p_sale_price: parseFloat(salePrice),
        p_stock: nextStock,
        p_min_stock: parseInt(minStock, 10) || 0,
        p_is_active: true,
        p_sku: trimmedSku || null,
      });

      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      const movementDelta = Number(result?.movement_delta || 0);

      if (isEditing) {
        toast.success(`"${name}" actualizado`, {
          description:
            movementDelta !== 0
              ? `Ajuste de stock: ${movementDelta > 0 ? "+" : ""}${movementDelta}`
              : "Datos actualizados",
        });
      } else {
        toast.success(`"${name}" creado`, {
          description:
            movementDelta !== 0
              ? `Codigo: ${finalBarcode} | Stock inicial: ${movementDelta}`
              : `Codigo: ${finalBarcode}`,
        });
      }

      resetForm();
      setOpen(false);
      onSaved?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al guardar";
      toast.error("Error al guardar producto", { description: message });
      console.error("[ProductForm] submit error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger render={trigger as React.ReactElement} />
      ) : (
        <DialogTrigger
          render={
            <Button className="border-0 bg-slate-900 text-white shadow-md shadow-slate-900/10 transition-all duration-200 hover:bg-slate-800" />
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          Nueva Prenda
        </DialogTrigger>
      )}

      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white shadow-xl sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100">
              <Package className="h-4 w-4 text-slate-700" />
            </div>
            {isEditing ? "Editar prenda" : "Nueva prenda"}
          </DialogTitle>
          <DialogDescription>
            Codigo, nombre, socia, precio y stock.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">

          {isEditing && (
            <div className="space-y-2">
              <Label htmlFor="prod-barcode" className="flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-slate-400" />
                Codigo de barras
              </Label>
              <Input
                id="prod-barcode"
                value={barcode}
                readOnly
                className="border-slate-200 bg-slate-50 font-mono shadow-sm text-slate-500 cursor-not-allowed"
              />
            </div>
          )}
          {!isEditing && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 flex items-center gap-2">
              <ScanLine className="h-4 w-4" />
              El codigo de barras se generara automaticamente al crear la prenda.
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="prod-name">Nombre de la prenda *</Label>
            <Input
              id="prod-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Jean recto tiro alto"
              className="border-slate-200 bg-white shadow-sm focus-visible:border-slate-900 focus-visible:ring-slate-900/10"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prod-sku" className="flex items-center gap-2">
              <Package className="h-4 w-4 text-slate-400" />
              Código interno (SKU)
            </Label>
            <Input
              id="prod-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Ej: BEY12"
              className="border-slate-200 bg-white font-mono shadow-sm focus-visible:border-slate-900 focus-visible:ring-slate-900/10"
            />
          </div>



          <div className="space-y-2">
            <Label>Socia *</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {partners.map((partner) => {
                const visual = getPartnerVisual(partner.name);
                const isSelected = ownerId === partner.id;

                return (
                  <button
                    key={partner.id}
                    type="button"
                    onClick={() => setOwnerId(partner.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                      isSelected
                        ? "shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
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
                      className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: visual.accent }}
                    >
                      {getPartnerInitial(partner.display_name)}
                    </span>
                    <span className="font-medium">{partner.display_name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="prod-sale">Precio venta ($) *</Label>
              <Input
                id="prod-sale"
                type="number"
                step="0.01"
                min="0"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="0.00"
                className="border-slate-200 bg-white font-mono shadow-sm focus-visible:border-slate-900 focus-visible:ring-slate-900/10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-stock">Stock actual</Label>
              <Input
                id="prod-stock"
                type="number"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="0"
                className="border-slate-200 bg-white font-mono shadow-sm focus-visible:border-slate-900 focus-visible:ring-slate-900/10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-minstock">Minimo alerta</Label>
              <Input
                id="prod-minstock"
                type="number"
                min="0"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                placeholder="2"
                className="border-slate-200 bg-white font-mono shadow-sm focus-visible:border-slate-900 focus-visible:ring-slate-900/10"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              resetForm();
              setOpen(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="border-0 bg-slate-900 text-white shadow-md shadow-slate-900/10 hover:bg-slate-800"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {isEditing ? "Guardar cambios" : "Crear prenda"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
