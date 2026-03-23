/**
 * @file print-ticket.ts
 * @description Impresion de ticket para desktop/web.
 */

"use client";

import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { APP_NAME } from "@/lib/constants";
import { getSavedTicketPrinterName } from "@/lib/local/printers";
import { getTierLabel } from "@/lib/pricing";
import { isTauriRuntime } from "@/lib/tauri-runtime";
import { formatEcuadorDate, formatEcuadorTime } from "@/lib/timezone-ecuador";
import type { CartItem, PartnerSaleSummary } from "@/types/database";

interface PrintTicketData {
  items: CartItem[];
  partnerSummaries: PartnerSaleSummary[];
  total: number;
  paymentMethod: "cash" | "transfer";
  saleId: string;
  date: Date;
}

const PAPER_WIDTH_MM = 58;
const LINE_WIDTH = 32;
const DIVIDER = "-".repeat(LINE_WIDTH);
const TOTAL_DIVIDER = "=".repeat(LINE_WIDTH);

const formatDate = (d: Date) =>
  formatEcuadorDate(d, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const formatTime = (d: Date) =>
  formatEcuadorTime(d, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

function normalizeTicketText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function centerText(value: string, width = LINE_WIDTH) {
  const text = normalizeTicketText(value).slice(0, width);
  const left = Math.max(0, Math.floor((width - text.length) / 2));
  return `${" ".repeat(left)}${text}`;
}

function padLine(left: string, right = "", width = LINE_WIDTH) {
  const safeLeft = normalizeTicketText(left);
  const safeRight = normalizeTicketText(right);
  const space = Math.max(1, width - safeLeft.length - safeRight.length);
  return `${safeLeft}${" ".repeat(space)}${safeRight}`.slice(0, width);
}

function wrapText(value: string, width: number) {
  const text = normalizeTicketText(value);
  if (!text) return [""];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word.slice(0, width);
      if (word.length > width) {
        lines.push(current);
        current = "";
      }
      continue;
    }

    if ((current + " " + word).length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word.slice(0, width);
      if (word.length > width) {
        lines.push(current);
        current = "";
      }
    }
  }

  if (current) lines.push(current);
  return lines;
}

function formatMoney(value: number) {
  return value.toFixed(2);
}

function buildItemsText(items: CartItem[]) {
  const lines: string[] = [];

  for (const item of items) {
    const nameLines = wrapText(item.name.toLowerCase(), LINE_WIDTH);
    lines.push(...nameLines);

    const tierSuffix =
      item.price_tier === "normal" ? "" : ` ${getTierLabel(item.price_tier)}`;
    const qtyPrice = `${item.quantity} x ${formatMoney(item.price_override)}${tierSuffix}`;
    const subtotal = formatMoney(item.subtotal);
    lines.push(padLine(qtyPrice, subtotal));
  }

  return lines;
}

function buildTicketText(data: PrintTicketData) {
  const { items, total, paymentMethod, saleId, date } = data;
  const lines: string[] = [];

  lines.push(centerText(APP_NAME));
  lines.push(centerText("sistema de punto de venta"));
  lines.push("");
  lines.push(padLine(`Fecha: ${formatDate(date)}`, `Hora: ${formatTime(date)}`));
  lines.push(`Nro: ${saleId.slice(0, 8).toUpperCase()}`);
  lines.push(DIVIDER);
  lines.push(padLine("Detalle", "Total"));
  lines.push(DIVIDER);
  lines.push(...buildItemsText(items));
  lines.push(TOTAL_DIVIDER);

  lines.push(padLine("Total a cancelar", formatMoney(total)));
  lines.push(padLine("Pago", paymentMethod === "cash" ? "Efectivo" : "Transfer."));
  lines.push(DIVIDER);
  lines.push(centerText("gracias por su compra"));
  lines.push(centerText(APP_NAME));

  return lines.join("\n");
}

function buildTicketHTML(data: PrintTicketData): string {
  const { saleId } = data;
  const ticketText = buildTicketText(data);

  return `<!DOCTYPE html>
<html>
<head>
  <title>Ticket - ${saleId.slice(0, 8)}</title>
  <style>
    @page {
      size: ${PAPER_WIDTH_MM}mm auto;
      margin: 0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Courier New", monospace;
      font-size: 9.5px;
      line-height: 1.08;
      width: ${PAPER_WIDTH_MM}mm;
      color: #000 !important;
      padding: 1mm 1.5mm;
      font-weight: 400;
    }
    pre {
      font-family: "Courier New", monospace;
      font-size: 9.5px;
      line-height: 1.08;
      white-space: pre-wrap;
      font-weight: 400;
    }
  </style>
</head>
<body>
  <pre>${ticketText}</pre>
</body>
</html>`;
}

export async function printTicketDirect(data: PrintTicketData): Promise<void> {
  const ticketText = buildTicketText(data);

  if (isTauriRuntime()) {
    const printerName = await getSavedTicketPrinterName();

    await invoke("print_text_ticket_silent", {
      ticketText,
      printerName,
    }).catch((error) => {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Error de impresion silenciosa";

      console.error("[print-ticket] print_text_ticket_silent error:", error);
      toast.error("No se pudo imprimir ticket", {
        description: message,
      });
    });
    return;
  }

  const html = buildTicketHTML(data);

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "-10000px";
  iframe.style.left = "-10000px";
  iframe.style.width = `${PAPER_WIDTH_MM}mm`;
  iframe.style.height = "0";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    return;
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  window.setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      const fallback = window.open("", "_blank", "width=320,height=600");
      if (fallback) {
        fallback.document.write(html);
        fallback.document.close();
        fallback.onload = () => {
          fallback.print();
          fallback.close();
        };
      }
    } finally {
      window.setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 1500);
    }
  }, 220);
}
