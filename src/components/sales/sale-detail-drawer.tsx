/**
 * @file sale-detail-drawer.tsx
 * @description Drawer lateral que muestra el detalle de un ticket de venta específico.
 *              Funciona como un recibo físico expansible.
 */

"use client";

import { X, Receipt, Printer, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { getPartnerConfigFromPartner } from "@/lib/partners";
import { getTierLabel } from "@/lib/pricing";
import { formatEcuadorDate, formatEcuadorTime } from "@/lib/timezone-ecuador";

export interface SaleDetailItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  price_tier?: string;
  subtotal: number;
  owner_id: string;
  partner: {
    display_name: string;
    color_hex: string;
    name: string;
  } | null;
}

export interface SaleDetailData {
  id: string;
  created_at: string;
  total: number;
  payment_method: string;
  sold_by_partner: {
    display_name: string;
    color_hex: string;
    name: string;
  } | null;
  sale_items: SaleDetailItem[];
}

interface SaleDetailDrawerProps {
  sale: SaleDetailData;
  onClose: () => void;
  onPrint?: () => void;
}

export function SaleDetailDrawer({
  sale,
  onClose,
  onPrint,
}: SaleDetailDrawerProps) {
  const formatTime = (d: string) =>
    formatEcuadorTime(d, {
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatDate = (d: string) =>
    formatEcuadorDate(d, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  const sellerConfig = getPartnerConfigFromPartner(sale.sold_by_partner);

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-slate-900/20 z-40 transition-opacity backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-[450px] bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-none">
                Ticket #{sale.id.slice(0, 8).toUpperCase()}
              </h2>
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-500">
                <Clock className="h-3 w-3" />
                {formatDate(sale.created_at)} a las {formatTime(sale.created_at)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onPrint && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onPrint}
                className="text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                title="Imprimir ticket"
              >
                <Printer className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 bg-slate-50/50">
          <div className="p-6 space-y-6">
            {/* Resumen de Venta */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">Registrado por</span>
                <Badge
                  variant="outline"
                  className="font-medium"
                  style={{
                    backgroundColor: sellerConfig.colorLight,
                    color: sellerConfig.color,
                    borderColor: sellerConfig.colorBorder,
                  }}
                >
                  {sellerConfig.displayName}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">Método de pago</span>
                <span className="text-sm font-medium text-slate-900 capitalize">
                  {sale.payment_method === "cash" ? "Efectivo" : "Transferencia"}
                </span>
              </div>
              <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                <span className="text-base font-semibold text-slate-900">Total Venta</span>
                <span className="text-2xl font-bold font-mono text-slate-900">
                  ${Number(sale.total).toFixed(2)}
                </span>
              </div>
            </div>

            {/* Detalles de Productos */}
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">
                Productos Comprados ({sale.sale_items.length})
              </h3>
              <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <table className="w-full text-left whitespace-nowrap">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="w-12 px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">Cant.</th>
                      <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Artículo</th>
                      <th className="w-20 px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">P. Unit</th>
                      <th className="w-20 px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/60 bg-white">
                    {sale.sale_items.map((item) => {
                      const partnerConf = getPartnerConfigFromPartner(item.partner);
                      return (
                        <tr key={item.id} className="group transition-colors hover:bg-slate-50/80">
                          <td className="px-2 py-1.5 text-center align-middle">
                            <span className="font-mono text-[12px] font-bold text-slate-700">{item.quantity}</span>
                          </td>
                          <td className="px-2 py-1.5 align-middle relative">
                            <div 
                              className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-md"
                              style={{ backgroundColor: partnerConf.color }}
                              title={partnerConf.displayName}
                            />
                            <div className="pl-1.5 flex flex-col justify-center">
                              <span className="truncate text-[11px] font-semibold text-slate-800 leading-tight block max-w-[200px]">
                                {item.product_name}
                              </span>
                              {item.price_tier && item.price_tier !== "normal" && (
                                <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600">
                                  {getTierLabel(item.price_tier as "normal" | "x3" | "x6" | "x12" | "manual")}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right align-middle">
                            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                              ${Number(item.unit_price).toFixed(2)}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right align-middle">
                            <span className="font-mono text-[12px] font-bold text-slate-900 tabular-nums">
                              ${Number(item.subtotal).toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
