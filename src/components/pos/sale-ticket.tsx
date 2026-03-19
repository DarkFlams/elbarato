"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { APP_NAME } from "@/lib/constants";
import { printTicketDirect } from "@/lib/print-ticket";
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
  const formatDate = (value: Date) =>
    value.toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const formatTime = (value: Date) =>
    value.toLocaleTimeString("es-EC", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const handlePrint = () => {
    void printTicketDirect({
      items,
      partnerSummaries,
      total,
      paymentMethod,
      saleId,
      date,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="border-slate-200 bg-white shadow-xl sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100">
              <Printer className="h-4 w-4 text-indigo-600" />
            </div>
            Ticket de Venta
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-black">
          <div className="text-center">
            <p className="text-sm font-bold">{APP_NAME}</p>
            <p className="text-[10px] text-gray-500">Sistema de Punto de Venta</p>
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

          {items.map((item, index) => (
            <div key={`${item.product_id}-${index}`}>
              <p className="text-[10px] font-medium">{item.name}</p>
              <div className="flex justify-between pl-2 text-[10px] text-gray-600">
                <span>
                  {item.quantity} x ${item.unit_price.toFixed(2)}
                </span>
                <span>${item.subtotal.toFixed(2)}</span>
              </div>
            </div>
          ))}

          <div className="border-t border-dashed border-gray-300" />

          <div className="flex justify-between text-sm font-bold">
            <span>TOTAL</span>
            <span>${total.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-[10px]">
            <span>Pago:</span>
            <span>{paymentMethod === "cash" ? "Efectivo" : "Transferencia"}</span>
          </div>

          <div className="border-t border-dashed border-gray-300" />
          <p className="text-center text-[9px] text-gray-500">
            Gracias por su compra
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            onClick={handlePrint}
            className="border-0 bg-indigo-600 text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-700"
          >
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
