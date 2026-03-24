/**
 * @file barcode-label.tsx
 * @description Generación y visualización de etiquetas de código de barras.
 *              Usa bwip-js para generar imágenes de barcode en canvas → data URL.
 *
 * FEATURES:
 * - Genera Code128 para códigos internos
 * - Preview de la etiqueta con nombre + precio + código
 * - Botón para imprimir etiqueta individual
 * - Botón para agregar a lote de impresión
 */

"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  buildProductLabelImageDataUrl,
  printProductLabels,
} from "@/lib/print-label";
import type { ProductWithOwner } from "@/types/database";

interface BarcodeLabelProps {
  product: ProductWithOwner | null;
  open: boolean;
  onClose: () => void;
}

export function BarcodeLabel({ product, open, onClose }: BarcodeLabelProps) {
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    if (!product || !open) return;

    const generateBarcode = async () => {
      try {
        const dataUrl = await buildProductLabelImageDataUrl(product, {
          priceTier: "normal",
        });
        setBarcodeDataUrl(dataUrl);
      } catch (err) {
        console.error("[BarcodeLabel] generation error:", err);
      }
    };

    generateBarcode();
  }, [product, open]);

  if (!product) return null;

  const handlePrintSingle = () => {
    if (!barcodeDataUrl) return;

    setIsPrinting(true);
    void printProductLabels({
      product,
      priceTier: "normal",
      copies: 1,
    })
      .then(() => {
        toast.success("Etiqueta enviada a impresion");
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "No se pudo imprimir la etiqueta";
        toast.error("Error al imprimir etiqueta", {
          description: message,
        });
      })
      .finally(() => {
        setIsPrinting(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[350px] bg-white border-slate-200 shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Printer className="h-4 w-4 text-indigo-600" />
            </div>
            Etiqueta de Producto
          </DialogTitle>
        </DialogHeader>

        {/* Preview de la etiqueta */}
        <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center space-y-2">
          <p className="text-xs font-bold text-gray-800 truncate">
            {product.name}
          </p>
          <p className="text-lg font-bold text-gray-900">
            ${Number(product.sale_price).toFixed(2)}
          </p>
          {barcodeDataUrl ? (
            <Image
              src={barcodeDataUrl}
              alt="Preview de etiqueta"
              width={600}
              height={360}
              unoptimized
              className="mx-auto w-full max-w-[260px] rounded border border-slate-200 bg-white"
            />
          ) : (
            <div className="flex h-[140px] items-center justify-center text-xs text-slate-400">
              Generando etiqueta...
            </div>
          )}

          <p className="text-[10px] text-gray-500">
            {product.owner.display_name}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            onClick={handlePrintSingle}
            disabled={!barcodeDataUrl || isPrinting}
            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 border-0"
          >
            <Printer className="h-4 w-4 mr-2" />
            {isPrinting ? "Imprimiendo..." : "Imprimir Etiqueta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
