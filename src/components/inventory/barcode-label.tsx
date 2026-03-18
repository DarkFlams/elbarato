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

import { useState, useEffect, useRef } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { ProductWithOwner } from "@/types/database";

interface BarcodeLabelProps {
  product: ProductWithOwner | null;
  open: boolean;
  onClose: () => void;
}

export function BarcodeLabel({ product, open, onClose }: BarcodeLabelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!product || !open) return;

    const generateBarcode = async () => {
      try {
        // Dynamic import bwip-js (only on client)
        const bwipjs = (await import("bwip-js")).default;

        const canvas = canvasRef.current;
        if (!canvas) return;

        bwipjs.toCanvas(canvas, {
          bcid: "code128",
          text: product.barcode,
          scale: 3,
          height: 10,
          includetext: true,
          textxalign: "center",
          textsize: 8,
        });

        setBarcodeDataUrl(canvas.toDataURL("image/png"));
      } catch (err) {
        console.error("[BarcodeLabel] generation error:", err);
      }
    };

    generateBarcode();
  }, [product, open]);

  if (!product) return null;

  const handlePrintSingle = () => {
    if (!barcodeDataUrl) return;

    const printWindow = window.open("", "_blank", "width=400,height=300");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Etiqueta - ${product.name}</title>
          <style>
            @page { size: 50mm 30mm; margin: 2mm; }
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
            .label {
              width: 46mm; height: 26mm;
              display: flex; flex-direction: column;
              align-items: center; justify-content: center;
              text-align: center; padding: 1mm;
            }
            .name { font-size: 8pt; font-weight: bold; margin-bottom: 1mm; }
            .price { font-size: 10pt; font-weight: bold; margin-bottom: 1mm; }
            .barcode img { max-width: 40mm; height: auto; }
            .owner { font-size: 6pt; color: #666; }
          </style>
        </head>
        <body>
          <div class="label">
            <div class="name">${product.name}</div>
            <div class="price">$${Number(product.sale_price).toFixed(2)}</div>
            <div class="barcode">
              <img src="${barcodeDataUrl}" alt="barcode" />
            </div>
            <div class="owner">${product.owner.display_name}</div>
          </div>
          <script>window.onload=()=>{window.print();window.close();}</script>
        </body>
      </html>
    `);
    printWindow.document.close();
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

          {/* Barcode canvas (hidden but used for generation) */}
          <canvas ref={canvasRef} className="mx-auto" />

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
            disabled={!barcodeDataUrl}
            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 border-0"
          >
            <Printer className="h-4 w-4 mr-2" />
            Imprimir Etiqueta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
