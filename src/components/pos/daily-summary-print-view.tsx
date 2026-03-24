"use client";

import { useMemo } from "react";
import type { SaleDetailData } from "@/components/sales/sale-detail-drawer";
import type { Expense, ExpenseAllocation } from "@/types/database";
import { formatEcuadorDate } from "@/lib/timezone-ecuador";

interface ExpenseWithAllocations extends Expense {
  expense_allocations: ExpenseAllocation[];
}

interface DailySummaryPrintViewProps {
  sales: SaleDetailData[];
  expenses: ExpenseWithAllocations[];
  fromDate: string | null;
  toDate: string | null;
}

interface ProductAgg {
  productName: string;
  partnerName: string;
  quantity: number;
  total: number;
}

interface ExpenseAgg {
  description: string;
  amount: number;
}

interface DailyAgg {
  dateSort: string;
  displayDate: string;
  products: ProductAgg[];
  expenses: ExpenseAgg[];
  totalSales: number;
  totalExpenses: number;
  net: number;
}

export function DailySummaryPrintView({
  sales,
  expenses,
  fromDate,
  toDate,
}: DailySummaryPrintViewProps) {
  const dailyData = useMemo(() => {
    const map = new Map<string, DailyAgg>();

    const getOrCreateDay = (rawDate: string | undefined | null) => {
      // Soporte tanto para ISO (T) como SQLite (espacio)
      if (!rawDate) rawDate = new Date().toISOString();
      const datePart = rawDate.substring(0, 10);
      
      if (!map.has(datePart)) {
        const d = new Date(datePart + "T12:00:00-05:00");
        const display = formatEcuadorDate(d.toISOString(), {
          weekday: "long",
          month: "long",
          day: "numeric",
        }).toUpperCase();

        map.set(datePart, {
          dateSort: datePart,
          displayDate: display,
          products: [],
          expenses: [],
          totalSales: 0,
          totalExpenses: 0,
          net: 0,
        });
      }
      return map.get(datePart)!;
    };

    // Agregar ventas (omitimos anuladas para el cuadre)
    for (const sale of sales) {
      if (sale.status === "voided") continue;

      const day = getOrCreateDay(sale.created_at);
      
      for (const item of sale.sale_items) {
        // Agrupar por producto y socia
        const pName = item.product_name || "Desconocido";
        const partnerName = item.partner?.name || "Otras";
        
        let existing = day.products.find(
          (p) => p.productName === pName && p.partnerName === partnerName
        );
        
        if (!existing) {
          existing = {
            productName: pName,
            partnerName: partnerName,
            quantity: 0,
            total: 0,
          };
          day.products.push(existing);
        }
        
        existing.quantity += item.quantity;
        existing.total += item.subtotal;
        day.totalSales += item.subtotal;
      }
    }

    // Agregar gastos
    for (const expense of expenses) {
      const day = getOrCreateDay(expense.created_at);
      
      day.expenses.push({
        description: expense.description,
        amount: Number(expense.amount || 0),
      });
      day.totalExpenses += Number(expense.amount || 0);
    }

    // Calcular netos y ordenar alfabeticamente los productos
    const result = Array.from(map.values()).sort((a, b) => a.dateSort.localeCompare(b.dateSort));
    
    for (const day of result) {
      day.net = day.totalSales - day.totalExpenses;
      day.products.sort((a, b) => {
        // Ordenar por socia y luego por producto
        if (a.partnerName !== b.partnerName) {
          return a.partnerName.localeCompare(b.partnerName);
        }
        return a.productName.localeCompare(b.productName);
      });
    }

    return result;
  }, [sales, expenses]);

  if (dailyData.length === 0) return null;

  return (
    <div className="hidden print:block print:w-full font-sans text-black">
      {/* Estilos para forzar pagina apaisada (Landscape) nativa del navegador */}
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: A4 landscape; margin: 10mm; }
        @media print {
          body { margin: 0; background: white; font-family: Arial, Helvetica, sans-serif; }
          /* Ocultar sidebar de navegacion */
          [data-slot="sidebar-wrapper"] { display: none !important; }
          /* Resetear margin/padding del contenedor principal para usar el 100% del A4 */
          [data-slot="sidebar-inset"] { 
            margin: 0 !important; 
            padding: 0 !important; 
            width: 100% !important;
          }
        }
      `}} />

      <h1 className="text-xl font-bold uppercase text-center mb-6">
        REPORTE CONSOLIDADO {fromDate && toDate ? `${fromDate} a ${toDate}` : ""}
      </h1>

      <div 
        className="w-full" 
        style={{
          columnCount: 3,
          columnGap: "2rem",
          columnFill: "auto"
        }}
      >
        {dailyData.map((day) => (
          <div 
            key={day.dateSort} 
            className="mb-8 break-inside-avoid"
          >
            {/* Header del Día */}
            <h2 className="text-sm font-bold text-center uppercase mb-1">
              {day.displayDate}
            </h2>

            {/* Ventas */}
            {day.products.length > 0 && (
              <table className="w-full text-xs border-collapse border border-black mb-2">
                <thead>
                  <tr className="bg-gray-200">
                    <th className="border border-black px-1 py-0.5 text-center w-8">ITEM</th>
                    <th className="border border-black px-1 py-0.5 text-center w-10">CANT</th>
                    <th className="border border-black px-1 py-0.5 text-left">Etiquetas de fila</th>
                    <th className="border border-black px-1 py-0.5 text-right w-16">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {day.products.map((p, idx) => (
                    <tr key={idx}>
                      <td className="border border-black px-1 py-0.5 text-center font-bold">{idx + 1}</td>
                      <td className="border border-black px-1 py-0.5 text-center font-bold">{p.quantity}</td>
                      <td className="border border-black px-1 py-0.5 text-left uppercase">
                        {p.productName} {p.partnerName !== "Otras" ? `(${p.partnerName})` : ""}
                      </td>
                      <td className="border border-black px-1 py-0.5 text-right font-bold tabular-nums">
                        {p.total.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100 font-bold">
                    <td className="border border-black px-1 py-0.5 text-center">{day.products.length + 1}</td>
                    <td className="border border-black px-1 py-0.5 text-center">#N/D</td>
                    <td className="border border-black px-1 py-0.5 text-left">Total general</td>
                    <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                      {day.totalSales.toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Gastos */}
            {day.expenses.length > 0 && (
              <>
                <h2 className="text-sm font-bold text-center uppercase mb-1">
                  GASTOS - {day.displayDate}
                </h2>
                <table className="w-full text-xs border-collapse border border-black mb-2">
                  <thead>
                    <tr className="bg-gray-200">
                      <th className="border border-black px-1 py-0.5 text-center w-8">ITEM</th>
                      <th className="border border-black px-1 py-0.5 text-left">Descripción del Gasto</th>
                      <th className="border border-black px-1 py-0.5 text-right w-16">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.expenses.map((e, idx) => (
                      <tr key={idx}>
                        <td className="border border-black px-1 py-0.5 text-center font-bold">{idx + 1}</td>
                        <td className="border border-black px-1 py-0.5 text-left uppercase">{e.description}</td>
                        <td className="border border-black px-1 py-0.5 text-right font-bold tabular-nums">
                          {e.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-100 font-bold">
                      <td className="border border-black px-1 py-0.5 text-center">{day.expenses.length + 1}</td>
                      <td className="border border-black px-1 py-0.5 text-left">Total general</td>
                      <td className="border border-black px-1 py-0.5 text-right tabular-nums">
                        {day.totalExpenses.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            {/* Resumen del Día */}
            <table className="w-full text-xs border-collapse border border-black mt-2">
              <tbody>
                <tr className="font-bold">
                  <td className="border border-black px-1 py-0.5 text-left w-3/4">TOTAL INGRESOS</td>
                  <td className="border border-black px-1 py-0.5 text-right tabular-nums whitespace-nowrap">{day.totalSales.toFixed(2)}</td>
                </tr>
                <tr className="font-bold">
                  <td className="border border-black px-1 py-0.5 text-left">TOTAL GASTOS</td>
                  <td className="border border-black px-1 py-0.5 text-right tabular-nums whitespace-nowrap text-red-700">-{day.totalExpenses.toFixed(2)}</td>
                </tr>
                <tr className="bg-gray-200 font-bold text-sm">
                  <td className="border border-black px-1 py-0.5 text-left">NETO DEL DÍA</td>
                  <td className="border border-black px-1 py-0.5 text-right tabular-nums whitespace-nowrap">{day.net.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
      
      {/* Footer Fijo */}
      <div className="w-full mt-8 border-t-2 border-black pt-2 text-right text-sm font-bold print:break-inside-avoid">
        <span>GRAN NETO DEL PERIODO: ${dailyData.reduce((acc, d) => acc + d.net, 0).toFixed(2)}</span>
      </div>
    </div>
  );
}
