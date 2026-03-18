/**
 * @file export-utils.ts
 * @description Utilidades para exportar reportes a Excel y PDF.
 *
 * DEPENDENCIAS:
 * - xlsx (SheetJS): Exportar datos tabulares a .xlsx
 * - jspdf + jspdf-autotable: Exportar reportes formateados a .pdf
 *
 * FUNCIONES:
 * - exportToExcel: Genera archivo Excel con múltiples hojas
 * - exportToPdf: Genera PDF con tabla formateada y colores de marca
 */

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// ============================================
// TIPOS
// ============================================

export interface ReportData {
  sessionId: string;
  date: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  partners: {
    name: string;
    displayName: string;
    color: string;
    totalSales: number;
    totalExpenses: number;
    netTotal: number;
    itemCount: number;
  }[];
  expenses: {
    description: string;
    amount: number;
    scope: string;
    allocations: string;
    time: string;
  }[];
  totalSales: number;
  totalExpenses: number;
  grandTotal: number;
}

// ============================================
// EXCEL EXPORT
// ============================================

export function exportToExcel(data: ReportData, filename?: string) {
  const wb = XLSX.utils.book_new();

  // Hoja 1: Resumen por socia
  const summaryRows = data.partners.map((p) => ({
    Socia: p.displayName,
    "Ventas ($)": p.totalSales,
    "Gastos ($)": p.totalExpenses,
    "Neto ($)": p.netTotal,
    "# Items": p.itemCount,
  }));
  summaryRows.push({
    Socia: "TOTAL",
    "Ventas ($)": data.totalSales,
    "Gastos ($)": data.totalExpenses,
    "Neto ($)": data.grandTotal,
    "# Items": summaryRows.reduce((s, r) => s + r["# Items"], 0),
  });

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen");

  // Hoja 2: Detalle de gastos
  if (data.expenses.length > 0) {
    const expenseRows = data.expenses.map((e) => ({
      Hora: e.time,
      Descripción: e.description,
      "Monto ($)": e.amount,
      Tipo: e.scope === "shared" ? "Compartido" : "Individual",
      Distribución: e.allocations,
    }));

    const wsExpenses = XLSX.utils.json_to_sheet(expenseRows);
    XLSX.utils.book_append_sheet(wb, wsExpenses, "Gastos");
  }

  // Hoja 3: Info de sesión
  const sessionInfo = [
    { Campo: "Fecha", Valor: data.date },
    { Campo: "Apertura", Valor: data.openedAt },
    { Campo: "Cierre", Valor: data.closedAt || "Abierta" },
    { Campo: "Caja Inicial ($)", Valor: data.openingCash },
    { Campo: "Total Ventas ($)", Valor: data.totalSales },
    { Campo: "Total Gastos ($)", Valor: data.totalExpenses },
    { Campo: "Neto ($)", Valor: data.grandTotal },
  ];

  const wsSession = XLSX.utils.json_to_sheet(sessionInfo);
  XLSX.utils.book_append_sheet(wb, wsSession, "Sesión");

  // Descargar
  const fname = filename || `Cierre_${data.date.replace(/\//g, "-")}.xlsx`;
  XLSX.writeFile(wb, fname);
}

// ============================================
// PDF EXPORT
// ============================================

export function exportToPdf(data: ReportData, filename?: string) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("POS Tienda de Ropa", pageWidth / 2, 20, { align: "center" });

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`Cierre de Caja — ${data.date}`, pageWidth / 2, 28, {
    align: "center",
  });

  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(
    `Apertura: ${data.openedAt} | Cierre: ${data.closedAt || "Abierta"} | Caja Inicial: $${data.openingCash.toFixed(2)}`,
    pageWidth / 2,
    35,
    { align: "center" }
  );
  doc.setTextColor(0);

  // Tabla de resumen por socia
  const tableBody = data.partners.map((p) => [
    p.displayName,
    `$${p.totalSales.toFixed(2)}`,
    `$${p.totalExpenses.toFixed(2)}`,
    `$${p.netTotal.toFixed(2)}`,
    String(p.itemCount),
  ]);

  // Fila de total
  tableBody.push([
    "TOTAL",
    `$${data.totalSales.toFixed(2)}`,
    `$${data.totalExpenses.toFixed(2)}`,
    `$${data.grandTotal.toFixed(2)}`,
    String(tableBody.reduce((s, r) => s + parseInt(r[4]), 0)),
  ]);

  autoTable(doc, {
    startY: 42,
    head: [["Socia", "Ventas", "Gastos", "Neto", "Items"]],
    body: tableBody,
    theme: "grid",
    headStyles: {
      fillColor: [139, 92, 246], // Violet
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    styles: {
      fontSize: 10,
      cellPadding: 4,
    },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "center" },
    },
    // Estilizar fila de total
    didParseCell: (hookData) => {
      if (hookData.row.index === tableBody.length - 1) {
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.fillColor = [245, 245, 245];
      }
    },
  });

  // Tabla de gastos (si hay)
  if (data.expenses.length > 0) {
    const lastY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Detalle de Gastos", 14, lastY + 15);

    const expenseBody = data.expenses.map((e) => [
      e.time,
      e.description,
      `$${e.amount.toFixed(2)}`,
      e.scope === "shared" ? "Compartido" : "Individual",
      e.allocations,
    ]);

    autoTable(doc, {
      startY: lastY + 20,
      head: [["Hora", "Descripción", "Monto", "Tipo", "Distribución"]],
      body: expenseBody,
      theme: "grid",
      headStyles: {
        fillColor: [245, 158, 11], // Amber
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      styles: {
        fontSize: 9,
        cellPadding: 3,
      },
      columnStyles: {
        2: { halign: "right" },
      },
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Generado el ${new Date().toLocaleDateString("es-EC")} a las ${new Date().toLocaleTimeString("es-EC")}`,
      14,
      doc.internal.pageSize.getHeight() - 10
    );
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageWidth - 14,
      doc.internal.pageSize.getHeight() - 10,
      { align: "right" }
    );
  }

  // Descargar
  const fname = filename || `Cierre_${data.date.replace(/\//g, "-")}.pdf`;
  doc.save(fname);
}
