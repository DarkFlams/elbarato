"use client";

import { invoke } from "@tauri-apps/api/core";
import type { PriceTier, ProductWithOwner } from "@/types/database";
import { getSavedLabelPrinterName } from "@/lib/local/printers";
import { getPriceForTier } from "@/lib/pricing";
import { isTauriRuntime } from "@/lib/tauri-runtime";

export const LABEL_WIDTH_MM = 50;
export const LABEL_HEIGHT_MM = 30;
export const ZEBRA_LABEL_DPI = 203;

const LABEL_CANVAS_WIDTH = 600;
const LABEL_CANVAS_HEIGHT = 360;
const LABEL_BUSINESS_NAME = "CREACIONES EL BARATO";
const BARCODE_BOX = {
  x: 28,
  y: 78,
  width: 232,
  height: 88,
};
const TEXT_BLOCK = {
  x: 24,
  y: 180,
  width: 548,
  height: 98,
};
const PRICE_BLOCK = {
  x: 24,
  y: 298,
  width: 270,
  height: 44,
};

export type LabelPriceTier = Exclude<PriceTier, "manual">;

type LabelRenderableProduct = Pick<
  ProductWithOwner,
  "name" | "barcode" | "sku" | "sale_price" | "sale_price_x3" | "sale_price_x6" | "sale_price_x12"
>;

interface LabelRenderOptions {
  priceTier?: LabelPriceTier;
  businessName?: string;
  copies?: number;
}

interface PrintLabelImageOptions {
  imageDataUrl: string;
  zplPayload?: string | null;
  printerName?: string | null;
  copies?: number;
}

interface PrintProductLabelsOptions {
  product: LabelRenderableProduct;
  priceTier?: LabelPriceTier;
  copies?: number;
  printerName?: string | null;
}

function normalizeLabelText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function sanitizeZplField(value: string) {
  return normalizeLabelText(value)
    .replace(/[\^~\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateLabelText(value: string, maxLength: number) {
  const normalized = sanitizeZplField(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function getLabelDots(mm: number) {
  return Math.round((mm / 25.4) * ZEBRA_LABEL_DPI);
}

function wrapText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const words = normalizeLabelText(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;

    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (words.length > 0 && lines.length > 0 && lines.length === maxLines) {
    const consumedWords = lines.join(" ").split(" ").length;
    if (consumedWords < words.length) {
      let lastLine = lines[maxLines - 1];
      while (ctx.measureText(`${lastLine}...`).width > maxWidth && lastLine.length > 0) {
        lastLine = lastLine.slice(0, -1).trimEnd();
      }
      lines[maxLines - 1] = `${lastLine}...`;
    }
  }

  return lines;
}

function getLabelPrice(product: LabelRenderableProduct, tier: LabelPriceTier) {
  return getPriceForTier(product, tier) ?? product.sale_price;
}

async function buildBarcodeCanvas(barcode: string) {
  const bwipjs = (await import("bwip-js")) as unknown as {
    toCanvas: (canvas: HTMLCanvasElement, options: Record<string, unknown>) => void;
  };
  const canvas = document.createElement("canvas");

  bwipjs.toCanvas(canvas, {
    bcid: "code128",
    text: barcode,
    scale: 3,
    height: 18,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
  });

  return canvas;
}

export async function buildProductLabelImageDataUrl(
  product: LabelRenderableProduct,
  options: LabelRenderOptions = {}
) {
  const priceTier = options.priceTier ?? "normal";
  const businessName = normalizeLabelText(options.businessName || LABEL_BUSINESS_NAME);
  const price = getLabelPrice(product, priceTier);
  const displayCode = normalizeLabelText(product.sku || product.barcode);
  const barcodeCanvas = await buildBarcodeCanvas(product.barcode);

  const canvas = document.createElement("canvas");
  canvas.width = LABEL_CANVAS_WIDTH;
  canvas.height = LABEL_CANVAS_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("No se pudo preparar la etiqueta");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  ctx.font = "700 26px 'Courier New', monospace";
  ctx.fillText(businessName, 24, 18);

  const barcodeScale = Math.min(
    BARCODE_BOX.width / barcodeCanvas.width,
    BARCODE_BOX.height / barcodeCanvas.height
  );
  const barcodeWidth = Math.round(barcodeCanvas.width * barcodeScale);
  const barcodeHeight = Math.round(barcodeCanvas.height * barcodeScale);
  const barcodeY = Math.round(BARCODE_BOX.y + (BARCODE_BOX.height - barcodeHeight) / 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(BARCODE_BOX.x, BARCODE_BOX.y, BARCODE_BOX.width, BARCODE_BOX.height);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(barcodeCanvas, BARCODE_BOX.x, barcodeY, barcodeWidth, barcodeHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.restore();

  // Blindamos la zona inferior de texto para que nunca la invada el barcode.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(TEXT_BLOCK.x, TEXT_BLOCK.y, TEXT_BLOCK.width, TEXT_BLOCK.height);

  ctx.fillStyle = "#000000";
  ctx.font = "700 18px 'Courier New', monospace";
  const productLines = wrapText(ctx, product.name, 536, 1);
  productLines.forEach((line, index) => {
    ctx.fillText(line, 28, TEXT_BLOCK.y + 8 + index * 22);
  });

  ctx.font = "700 16px 'Courier New', monospace";
  ctx.fillText(`CODIGO: ${displayCode}`, 28, TEXT_BLOCK.y + 40);
  ctx.fillText(`BARRAS: ${normalizeLabelText(product.barcode)}`, 28, TEXT_BLOCK.y + 68);

  ctx.fillStyle = "#111827";
  ctx.fillRect(PRICE_BLOCK.x, PRICE_BLOCK.y, PRICE_BLOCK.width, PRICE_BLOCK.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 22px 'Courier New', monospace";
  ctx.fillText("PVP", PRICE_BLOCK.x + 14, PRICE_BLOCK.y + 10);
  ctx.font = "700 30px 'Courier New', monospace";
  ctx.fillText(Number(price).toFixed(2), PRICE_BLOCK.x + 100, PRICE_BLOCK.y + 6);

  return canvas.toDataURL("image/png");
}

export function buildProductLabelZpl(
  product: LabelRenderableProduct,
  options: LabelRenderOptions = {}
) {
  const priceTier = options.priceTier ?? "normal";
  const copies = Math.min(Math.max(Math.trunc(options.copies ?? 1) || 1, 1), 200);
  const businessName = truncateLabelText(options.businessName || LABEL_BUSINESS_NAME, 26);
  const barcode = sanitizeZplField(product.barcode).replace(/\s+/g, "");
  const displayCode = truncateLabelText(product.sku || product.barcode, 18);
  const productName = truncateLabelText(product.name, 30);
  const price = getLabelPrice(product, priceTier);
  const barcodeModuleWidth = barcode.length > 10 ? 1 : 2;

  return [
    "^XA",
    `^PW${getLabelDots(LABEL_WIDTH_MM)}`,
    `^LL${getLabelDots(LABEL_HEIGHT_MM)}`,
    "^LH0,0",
    "^CI28",
    `^FO16,10^A0N,28,28^FD${businessName}^FS`,
    `^BY${barcodeModuleWidth},2,58`,
    `^FO18,46^BCN,58,N,N,N^FD${barcode}^FS`,
    `^FO18,122^A0N,22,22^FD${productName}^FS`,
    `^FO18,148^A0N,18,18^FDCODIGO: ${displayCode}^FS`,
    `^FO18,170^A0N,18,18^FDBARRAS: ${barcode}^FS`,
    "^FO18,198^GB190,28,28,B,0^FS",
    "^FO32,201^A0N,21,21^FR^FDPVP^FS",
    `^FO108,197^A0N,28,28^FR^FD${Number(price).toFixed(2)}^FS`,
    `^PQ${copies},0,1,N`,
    "^XZ",
  ].join("\n");
}

export async function printLabelImageDataUrl({
  imageDataUrl,
  zplPayload,
  printerName,
  copies = 1,
}: PrintLabelImageOptions) {
  const safeCopies = Math.min(Math.max(Math.trunc(copies) || 1, 1), 200);

  if (isTauriRuntime()) {
    await invoke("print_label_image_silent", {
      imageDataUrl,
      zplPayload: zplPayload?.trim() || null,
      printerName: printerName?.trim() || null,
      copies: safeCopies,
      widthMm: LABEL_WIDTH_MM,
      heightMm: LABEL_HEIGHT_MM,
    });
    return;
  }

  const printWindow = window.open("", "_blank", "width=520,height=520");
  if (!printWindow) {
    throw new Error("No se pudo abrir la ventana de impresion");
  }

  const labels = Array.from({ length: safeCopies }, () => imageDataUrl);
  const labelMarkup = labels
    .map(
      (src) => `
        <div class="label-sheet">
          <img src="${src}" alt="Etiqueta" />
        </div>
      `
    )
    .join("");

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Etiquetas</title>
        <style>
          @page { size: ${LABEL_WIDTH_MM}mm ${LABEL_HEIGHT_MM}mm; margin: 0; }
          html, body { margin: 0; padding: 0; background: white; }
          body { font-family: Arial, sans-serif; }
          .label-sheet {
            width: ${LABEL_WIDTH_MM}mm;
            height: ${LABEL_HEIGHT_MM}mm;
            page-break-after: always;
            break-after: page;
            display: flex;
            align-items: stretch;
            justify-content: stretch;
          }
          .label-sheet:last-child { page-break-after: auto; break-after: auto; }
          img {
            width: 100%;
            height: 100%;
            display: block;
          }
        </style>
      </head>
      <body>${labelMarkup}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  printWindow.close();
}

export async function printProductLabels({
  product,
  priceTier = "normal",
  copies = 1,
  printerName,
}: PrintProductLabelsOptions) {
  const imageDataUrl = await buildProductLabelImageDataUrl(product, { priceTier });
  const zplPayload = buildProductLabelZpl(product, { priceTier, copies });
  const selectedPrinter = printerName === undefined ? await getSavedLabelPrinterName() : printerName;

  await printLabelImageDataUrl({
    imageDataUrl,
    zplPayload,
    printerName: selectedPrinter,
    copies,
  });
}

export async function buildSampleLabelImageDataUrl() {
  return buildProductLabelImageDataUrl({
    name: "PANTY PUSH UP SILIC",
    barcode: "8530",
    sku: "PPUCS5996TL",
    sale_price: 15.25,
    sale_price_x3: 14.75,
    sale_price_x6: 14.5,
    sale_price_x12: 14.25,
  });
}

export async function buildSampleLabelPrintPayload(copies = 1) {
  const sampleProduct = {
    name: "PANTY PUSH UP SILIC",
    barcode: "8530",
    sku: "PPUCS5996TL",
    sale_price: 15.25,
    sale_price_x3: 14.75,
    sale_price_x6: 14.5,
    sale_price_x12: 14.25,
  };

  return {
    imageDataUrl: await buildProductLabelImageDataUrl(sampleProduct),
    zplPayload: buildProductLabelZpl(sampleProduct, { copies }),
  };
}
