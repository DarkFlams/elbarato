/**
 * @file sale-ticket.tsx
 * @description Ticket de venta para impresión (térmica o CSS fallback).
 *
 * DOS MODOS DE IMPRESIÓN:
 * 1. window.print() con CSS @media print (funciona en cualquier impresora)
 * 2. Ventana de impresión dedicada formateada para 58mm/80mm
 *
 * DATOS DEL TICKET:
 * - Nombre del negocio
 * - Fecha y hora
 * - Items con nombre, cantidad, precio unitario, subtotal
 * - Desglose por socia
 * - Total + método de pago
 * - Código de transacción
 */

"use client";

import { useEffect, useRef } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { APP_NAME } from "@/lib/constants";
import type { CartItem, PartnerSaleSummary } from "@/types/database";

interface SaleTicketProps {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  partnerSummaries: PartnerSaleSummary[];
  total: number;
  paymentMethod: "cash" | "transfer";
  saleId: string;
  date: Date;
}

export function SaleTicket({
  open,
  onClose,
  items,
  partnerSummaries,
  total,
  paymentMethod,
  saleId,
  date,
}: SaleTicketProps) {
  const ticketRef = useRef<HTMLDivElement>(null);
  const hasPrintedRef = useRef(false);

  // Auto-print when the dialog opens after a sale
  useEffect(() => {
    if (open && !hasPrintedRef.current) {
      hasPrintedRef.current = true;
      // Small delay to let dialog render before triggering print
      const timer = setTimeout(() => {
        handlePrint();
      }, 400);
      return () => clearTimeout(timer);
    }
    if (!open) {
      hasPrintedRef.current = false;
    }
  }, [open]);

  const formatDate = (d: Date) =>
    d.toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("es-EC", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=350,height=600");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ticket - ${saleId.slice(0, 8)}</title>
          <style>
            @page { size: 80mm auto; margin: 2mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Courier New', monospace;
              font-size: 11px;
              width: 76mm;
              color: #000;
            }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .divider {
              border-top: 1px dashed #000;
              margin: 4px 0;
            }
            .row {
              display: flex;
              justify-content: space-between;
              padding: 1px 0;
            }
            .item-name { font-size: 10px; }
            .item-detail {
              display: flex;
              justify-content: space-between;
              font-size: 10px;
              padding-left: 8px;
              color: #444;
            }
            .total-row {
              display: flex;
              justify-content: space-between;
              font-weight: bold;
              font-size: 14px;
              padding: 4px 0;
            }
            .footer { font-size: 9px; color: #666; text-align: center; margin-top: 8px; }
          </style>
        </head>
        <body>
          <div class="center bold" style="font-size:14px;padding:4px 0;">
            ${APP_NAME}
          </div>
          <div class="center" style="font-size:9px;color:#666;">
            Sistema de Punto de Venta
          </div>
          <div class="divider"></div>

          <div class="row">
            <span>Fecha:</span>
            <span>${formatDate(date)}</span>
          </div>
          <div class="row">
            <span>Hora:</span>
            <span>${formatTime(date)}</span>
          </div>
          <div class="row">
            <span>Nro:</span>
            <span>${saleId.slice(0, 8).toUpperCase()}</span>
          </div>
          <div class="divider"></div>

          ${items
            .map(
              (item) => `
            <div class="item-name">${item.name}</div>
            <div class="item-detail">
              <span>${item.quantity} x $${item.unit_price.toFixed(2)}</span>
              <span>$${item.subtotal.toFixed(2)}</span>
            </div>
          `
            )
            .join("")}

          <div class="divider"></div>

          ${partnerSummaries
            .map(
              (s) => `
            <div class="row" style="font-size:10px;">
              <span>${s.display_name}:</span>
              <span>$${s.total.toFixed(2)}</span>
            </div>
          `
            )
            .join("")}

          <div class="divider"></div>

          <div class="total-row">
            <span>TOTAL</span>
            <span>$${total.toFixed(2)}</span>
          </div>

          <div class="row" style="font-size:10px;">
            <span>Pago:</span>
            <span>${paymentMethod === "cash" ? "Efectivo" : "Transferencia"}</span>
          </div>

          <div class="divider"></div>
          <div class="footer">
            ¡Gracias por su compra!<br/>
            ${APP_NAME}
          </div>

          <script>
            window.onload = () => { window.print(); window.close(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[340px] bg-white border-slate-200 shadow-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Printer className="h-4 w-4 text-indigo-600" />
            </div>
            Ticket de Venta
          </DialogTitle>
        </DialogHeader>

        {/* Preview del ticket */}
        <div
          ref={ticketRef}
          className="rounded-lg border border-slate-200 bg-slate-50 text-black p-4 font-mono text-xs space-y-2"
        >
          <div className="text-center">
            <p className="font-bold text-sm">{APP_NAME}</p>
            <p className="text-[10px] text-gray-500">
              Sistema de Punto de Venta
            </p>
          </div>

          <div className="border-t border-dashed border-gray-300" />

          <div className="flex justify-between">
            <span>Fecha:</span>
            <span>{formatDate(date)}</span>
          </div>
          <div className="flex justify-between">
            <span>Hora:</span>
            <span>{formatTime(date)}</span>
          </div>
          <div className="flex justify-between">
            <span>Nro:</span>
            <span>{saleId.slice(0, 8).toUpperCase()}</span>
          </div>

          <div className="border-t border-dashed border-gray-300" />

          {items.map((item, i) => (
            <div key={i}>
              <p className="text-[10px] font-medium">{item.name}</p>
              <div className="flex justify-between text-[10px] text-gray-600 pl-2">
                <span>
                  {item.quantity} x ${item.unit_price.toFixed(2)}
                </span>
                <span>${item.subtotal.toFixed(2)}</span>
              </div>
            </div>
          ))}

          <div className="border-t border-dashed border-gray-300" />

          {partnerSummaries.map((s) => (
            <div
              key={s.partner_id}
              className="flex justify-between text-[10px]"
            >
              <span>{s.display_name}:</span>
              <span>${s.total.toFixed(2)}</span>
            </div>
          ))}

          <div className="border-t border-dashed border-gray-300" />

          <div className="flex justify-between font-bold text-sm">
            <span>TOTAL</span>
            <span>${total.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-[10px]">
            <span>Pago:</span>
            <span>
              {paymentMethod === "cash" ? "Efectivo" : "Transferencia"}
            </span>
          </div>

          <div className="border-t border-dashed border-gray-300" />
          <p className="text-center text-[9px] text-gray-400">
            ¡Gracias por su compra!
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            onClick={handlePrint}
            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 border-0"
          >
            <Printer className="h-4 w-4 mr-2" />
            Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
