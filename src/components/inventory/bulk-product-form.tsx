/**
 * @file bulk-product-form.tsx
 * @description Modal para registrar múltiples prendas de forma masiva.
 *              Cada fila = 1 prenda. Nombre completo (con talla incluida).
 */

"use client";

import { useCallback, useState } from "react";
import { Loader2, Plus, Save, Trash2, Layers, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  generateCatalogBarcode,
  saveCatalogProduct,
} from "@/lib/local/catalog";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Partner } from "@/types/database";
import { getPartnerVisual } from "./inventory-ui";

interface BulkProductFormProps {
  partners: Partner[];
  onSaved?: () => void;
}

interface BulkEntry {
  id: string;
  name: string;
  sku: string;
  stock: string;
  price: string;
}

function createEmptyEntry(): BulkEntry {
  return {
    id: crypto.randomUUID(),
    name: "",
    sku: "",
    stock: "1",
    price: "",
  };
}

async function upsertProductRemote(input: {
  barcode: string;
  sku?: string | null;
  name: string;
  ownerId: string;
  salePrice: number;
  stock: number;
  minStock: number;
}) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("upsert_product_with_movement", {
    p_product_id: null,
    p_barcode: input.barcode,
    p_name: input.name,
    p_description: null,
    p_category: null,
    p_owner_id: input.ownerId,
    p_purchase_price: 0,
    p_sale_price: input.salePrice,
    p_sale_price_x3: null,
    p_sale_price_x6: null,
    p_sale_price_x12: null,
    p_stock: input.stock,
    p_min_stock: input.minStock,
    p_is_active: true,
    p_sku: input.sku || null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export function BulkProductForm({ partners, onSaved }: BulkProductFormProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [ownerId, setOwnerId] = useState<string>("");
  const [globalPrice, setGlobalPrice] = useState("");
  const [entries, setEntries] = useState<BulkEntry[]>([
    createEmptyEntry(),
    createEmptyEntry(),
    createEmptyEntry(),
  ]);

  const resetForm = useCallback(() => {
    setOwnerId("");
    setGlobalPrice("");
    setEntries([createEmptyEntry(), createEmptyEntry(), createEmptyEntry()]);
  }, []);

  const addEntry = () => {
    setEntries((prev) => [...prev, createEmptyEntry()]);
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((e) => e.id !== id);
    });
  };

  const updateEntry = (id: string, field: keyof BulkEntry, value: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  // Count valid entries (ones with a name)
  const validEntries = entries.filter((e) => e.name.trim());
  const validCount = validEntries.length;

  const handleSubmit = async () => {
    if (!ownerId) {
      toast.error("Selecciona la dueña de las prendas");
      return;
    }

    if (validCount === 0) {
      toast.error("No hay prendas que guardar", {
        description: "Escribe al menos un nombre.",
      });
      return;
    }

    const hasNoPrice = validEntries.some(
      (e) => !e.price && !globalPrice
    );
    if (hasNoPrice) {
      toast.error("Hay prendas sin precio", {
        description: "Pon un precio global o un precio en cada fila.",
      });
      return;
    }

    setIsSubmitting(true);

    let savedCount = 0;
    let errorCount = 0;

    for (const entry of validEntries) {
      try {
        const barcode = await generateCatalogBarcode();
        const price = parseFloat(entry.price || globalPrice) || 0;
        const stock = parseInt(entry.stock, 10) || 0;

        await saveCatalogProduct({
          productId: null,
          remoteId: null,
          barcode,
          sku: entry.sku.trim() || null,
          name: entry.name.trim(),
          description: null,
          category: null,
          ownerId,
          purchasePrice: 0,
          salePrice: price,
          salePriceX3: null,
          salePriceX6: null,
          salePriceX12: null,
          stock,
          minStock: 2,
          isActive: true,
        }).catch(async () => {
          return upsertProductRemote({
            barcode,
            sku: entry.sku.trim() || null,
            name: entry.name.trim(),
            ownerId,
            salePrice: price,
            stock,
            minStock: 2,
          });
        });

        savedCount++;
      } catch (err) {
        errorCount++;
        console.error(
          `[BulkProductForm] Error saving "${entry.name}":`,
          err
        );
      }
    }

    setIsSubmitting(false);

    if (errorCount > 0) {
      toast.warning(`${savedCount} guardadas, ${errorCount} con error`);
    } else {
      toast.success(`${savedCount} prendas creadas correctamente 🎉`);
    }

    resetForm();
    setOpen(false);
    onSaved?.();
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    entryId: string,
    field: keyof BulkEntry
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const currentIndex = entries.findIndex((en) => en.id === entryId);
      const fieldOrder: (keyof BulkEntry)[] = [
        "name",
        "sku",
        "stock",
        "price",
      ];
      const currentFieldIdx = fieldOrder.indexOf(field);

      if (currentFieldIdx === fieldOrder.length - 1) {
        // Last field → jump to next row or add one
        if (currentIndex === entries.length - 1) {
          addEntry();
          setTimeout(() => {
            const inputs = document.querySelectorAll<HTMLInputElement>(
              `[data-bulk-field="name"]`
            );
            inputs[inputs.length - 1]?.focus();
          }, 50);
        } else {
          const nextEntry = entries[currentIndex + 1];
          document
            .querySelector<HTMLInputElement>(
              `[data-bulk-id="${nextEntry.id}"][data-bulk-field="name"]`
            )
            ?.focus();
        }
      } else {
        // Next field in same row
        const nextField = fieldOrder[currentFieldIdx + 1];
        document
          .querySelector<HTMLInputElement>(
            `[data-bulk-id="${entryId}"][data-bulk-field="${nextField}"]`
          )
          ?.focus();
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            className="border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm"
          />
        }
      >
        <Layers className="mr-2 h-4 w-4" />
        Registro Masivo
      </DialogTrigger>

      <DialogContent className="max-h-[92vh] overflow-hidden bg-white shadow-2xl sm:max-w-[680px] p-0 border-0 rounded-2xl flex flex-col">
        {/* Header */}
        <div className="bg-slate-50 px-6 pt-6 pb-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-600" />
            Registro Masivo
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Cada fila es una prenda. Incluye la talla en el nombre.
          </p>
        </div>

        {/* Configuración Global */}
        <div className="px-6 pt-4 pb-3 border-b border-slate-100 space-y-3">
          <div>
            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
              Dueña (aplica a todas)
            </Label>
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
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition-all border outline-none select-none flex items-center gap-1.5",
                      isSelected
                        ? "shadow-sm"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
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
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: visual.accent }}
                    />
                    {partner.display_name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
              Precio base ($)
            </Label>
            <div className="relative w-32">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                $
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={globalPrice}
                onChange={(e) => setGlobalPrice(e.target.value)}
                className="pl-7 h-9 text-sm font-bold bg-white border-slate-200 tabular-nums"
              />
            </div>
            <span className="text-[10px] text-slate-400">
              Se aplica a las que no tengan precio propio
            </span>
          </div>
        </div>

        {/* Tabla de Entradas */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {/* Cabecera */}
          <div className="grid grid-cols-[1fr_100px_60px_80px_32px] gap-2 mb-2 px-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Nombre
            </span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Código
            </span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Stock
            </span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Precio
            </span>
            <span />
          </div>

          {/* Filas */}
          <div className="space-y-1.5">
            {entries.map((entry, index) => (
              <div
                key={entry.id}
                className="grid grid-cols-[1fr_100px_60px_80px_32px] gap-2 items-center"
              >
                <Input
                  data-bulk-id={entry.id}
                  data-bulk-field="name"
                  value={entry.name}
                  onChange={(e) =>
                    updateEntry(entry.id, "name", e.target.value)
                  }
                  onKeyDown={(e) => handleKeyDown(e, entry.id, "name")}
                  className="h-8 text-xs bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-indigo-300 focus-visible:ring-indigo-300/20"
                  autoFocus={index === 0}
                  autoComplete="off"
                />
                <Input
                  data-bulk-id={entry.id}
                  data-bulk-field="sku"
                  value={entry.sku}
                  onChange={(e) =>
                    updateEntry(entry.id, "sku", e.target.value)
                  }
                  onKeyDown={(e) => handleKeyDown(e, entry.id, "sku")}
                  className="h-8 text-xs font-mono bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-indigo-300"
                  autoComplete="off"
                />
                <Input
                  data-bulk-id={entry.id}
                  data-bulk-field="stock"
                  type="number"
                  min="0"
                  value={entry.stock}
                  onChange={(e) =>
                    updateEntry(entry.id, "stock", e.target.value)
                  }
                  onKeyDown={(e) => handleKeyDown(e, entry.id, "stock")}
                  className="h-8 text-xs font-mono bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-amber-300 tabular-nums text-center"
                  autoComplete="off"
                />
                <Input
                  data-bulk-id={entry.id}
                  data-bulk-field="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={entry.price}
                  onChange={(e) =>
                    updateEntry(entry.id, "price", e.target.value)
                  }
                  onKeyDown={(e) => handleKeyDown(e, entry.id, "price")}
                  className="h-8 text-xs font-mono bg-slate-50 border-transparent focus-visible:bg-white focus-visible:border-emerald-300 tabular-nums"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  className={cn(
                    "h-8 w-8 flex items-center justify-center rounded-md text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors",
                    entries.length <= 1 && "invisible"
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addEntry}
            className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors select-none"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar otra prenda
          </button>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {validCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <Copy className="h-3.5 w-3.5 text-indigo-500" />
                <span>
                  Se crearán{" "}
                  <span className="text-indigo-600 font-bold">
                    {validCount}
                  </span>{" "}
                  {validCount === 1 ? "prenda" : "prendas"}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="text-slate-400 hover:text-slate-600 font-semibold text-xs"
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
            >
              Cerrar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || validCount === 0}
              className="px-6 bg-slate-900 border-0 text-white font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 hover:-translate-y-0.5 transition-all duration-200 text-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Guardar {validCount > 0 ? `${validCount} Prendas` : "Lote"}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
