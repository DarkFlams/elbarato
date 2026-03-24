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
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import {
  formatEcuadorDate,
  formatEcuadorDateTime,
  formatEcuadorTime,
  toEcuadorDateInput,
} from "@/lib/timezone-ecuador";

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
      `Generado el ${formatEcuadorDate(new Date())} a las ${formatEcuadorTime(new Date())}`,
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
// ============================================
// SALES LIST EXPORT
// ============================================

export interface SaleExportData {
  id: string;
  date: string;
  time: string;
  partner: string;
  products: string;
  method: string;
  total: number;
}

export interface LiquidationExpense {
  description: string;
  amount: number;
  date: string;
}

export interface LiquidationData {
  totalSales: number;
  totalExpenses: number;
  netIncome: number;
  partnerName: string;
  expensesDetail: LiquidationExpense[];
}

export async function exportSalesToExcel(
  sales: SaleExportData[], 
  liquidation: LiquidationData,
  filename?: string
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Ventas", {
    views: [{ showGridLines: false }]
  });

  sheet.columns = [
    { key: "id", width: 14 },
    { key: "date", width: 16 },
    { key: "time", width: 12 },
    { key: "partner", width: 22 },
    { key: "products", width: 65 },
    { key: "method", width: 18 },
    { key: "total", width: 16 },
  ];

  // ===================================
  // CABECERA DEL REPORTE
  // ===================================
  sheet.mergeCells("A1:G1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = "REPORTE DETALLADO DE VENTAS";
  titleCell.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } }; // Indigo 600
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 30;

  // METADATOS Y LIQUIDACIÓN
  sheet.getCell("A3").value = "Generado el:";
  sheet.getCell("A3").font = { bold: true, color: { argb: "FF475569" } };
  sheet.getCell("B3").value = formatEcuadorDateTime(new Date());

  sheet.getCell("A4").value = "Filtro Aplicado:";
  sheet.getCell("A4").font = { bold: true, color: { argb: "FF475569" } };
  sheet.getCell("B4").value = liquidation.partnerName;

  sheet.getCell("A5").value = "Total de Tickets:";
  sheet.getCell("A5").font = { bold: true, color: { argb: "FF475569" } };
  sheet.getCell("B5").value = sales.length;

  // Cuadro de Resumen Financiero
  sheet.getCell("D3").value = "RESUMEN DE LIQUIDACIÓN";
  sheet.getCell("D3").font = { bold: true, size: 11, color: { argb: "FF0F172A" } };

  sheet.getCell("D4").value = "Ventas Brutas:";
  sheet.getCell("D4").font = { bold: true, color: { argb: "FF475569" } };
  sheet.getCell("E4").value = liquidation.totalSales;
  sheet.getCell("E4").numFmt = '"$"#,##0.00';

  sheet.getCell("D5").value = "Gastos Deducidos:";
  sheet.getCell("D5").font = { bold: true, color: { argb: "FF475569" } };
  sheet.getCell("E5").value = liquidation.totalExpenses;
  sheet.getCell("E5").numFmt = '"-$"#,##0.00';
  sheet.getCell("E5").font = { color: { argb: "FFDC2626" }, bold: true };

  sheet.getCell("D6").value = "Liquidación Neta:";
  sheet.getCell("D6").font = { bold: true, color: { argb: "FF475569" } };
  sheet.getCell("E6").value = liquidation.netIncome;
  sheet.getCell("E6").numFmt = '"$"#,##0.00';
  sheet.getCell("E6").font = { bold: true, color: { argb: "FF16A34A" }, size: 12 };

  // ===================================
  // CABECERA DE LA TABLA
  // ===================================
  const headerRow = sheet.getRow(8);
  headerRow.values = [
    "TICKET #",
    "FECHA",
    "HORA",
    "SOCIA / ORIGEN",
    "PRODUCTOS VENDIDOS",
    "MÉTODO DE PAGO",
    "TOTAL ($)"
  ];
  headerRow.height = 22;

  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; // Slate 100
    cell.font = { bold: true, color: { argb: "FF334155" }, size: 10 }; // Slate 700
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });

  // ===================================
  // DATOS
  // ===================================
  let currentRow = 9;
  sales.forEach((s, index) => {
    const row = sheet.getRow(currentRow);
    row.values = {
      id: s.id.toUpperCase(),
      date: s.date,
      time: s.time,
      partner: s.partner,
      products: s.products,
      method: s.method,
      total: s.total
    };

    const isEven = index % 2 === 0;
    const bgColor = isEven ? "FFFFFFFF" : "FFF8FAFC"; // White or Slate 50

    row.eachCell((cell, colNumber) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      cell.border = {
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      cell.alignment = { 
        vertical: "middle", 
        horizontal: colNumber === 7 ? "right" : "left", 
        wrapText: colNumber === 5 
      };
      if (colNumber === 7) cell.numFmt = '"$"#,##0.00';
    });
    
    // Auto-adjust height for products wrap text
    if (s.products.length > 55) {
      row.height = 20 + Math.floor(s.products.length / 55) * 12;
    } else {
      row.height = 20;
    }

    currentRow++;
  });

  // ===================================
  // FILA DE TOTALES FINAL
  // ===================================
  const tableTotalRow = sheet.getRow(currentRow);
  tableTotalRow.values = {
    method: "SUBTOTAL BRUTO:",
    total: liquidation.totalSales
  };
  tableTotalRow.height = 25;

  tableTotalRow.eachCell((cell, colNumber) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    
    if (colNumber >= 6) {
      cell.font = { bold: true, color: { argb: "FF0F172A" } };
      cell.border = {
        top: { style: "double", color: { argb: "FF94A3B8" } },
        bottom: { style: "thick", color: { argb: "FF94A3B8" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      cell.alignment = { vertical: "middle", horizontal: "right" };
    } else {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
      }
    }
    
    if (colNumber === 7) {
      cell.numFmt = '"$"#,##0.00';
    }
  });

  // ===================================
  // DETALLE DE GASTOS DEDUCIDOS
  // ===================================
  if (liquidation.expensesDetail && liquidation.expensesDetail.length > 0) {
    currentRow += 3;
    
    const expTitleRow = sheet.getRow(currentRow);
    expTitleRow.getCell("D").value = "DETALLE DE GASTOS DEDUCIDOS";
    expTitleRow.getCell("D").font = { bold: true, size: 11, color: { argb: "FF0F172A" } };
    currentRow++;

    const expHeaderRow = sheet.getRow(currentRow);
    expHeaderRow.getCell("D").value = "DESCRIPCIÓN DEL GASTO";
    sheet.mergeCells(`D${currentRow}:F${currentRow}`);
    expHeaderRow.getCell("G").value = "MONTO ($)";
    expHeaderRow.height = 20;
    
    ["D", "E", "F"].forEach(col => {
      expHeaderRow.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
      expHeaderRow.getCell(col).font = { bold: true, color: { argb: "FF991B1B" } };
      expHeaderRow.getCell(col).border = { bottom: { style: "thin", color: { argb: "FFFCA5A5" } } };
    });
    expHeaderRow.getCell("D").alignment = { vertical: "middle", horizontal: "left" };
    
    expHeaderRow.getCell("G").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
    expHeaderRow.getCell("G").font = { bold: true, color: { argb: "FF991B1B" } };
    expHeaderRow.getCell("G").alignment = { vertical: "middle", horizontal: "right" };
    expHeaderRow.getCell("G").border = { bottom: { style: "thin", color: { argb: "FFFCA5A5" } } };
    
    currentRow++;

    liquidation.expensesDetail.forEach(exp => {
      const row = sheet.getRow(currentRow);
      row.getCell("D").value = exp.description;
      sheet.mergeCells(`D${currentRow}:F${currentRow}`);
      row.getCell("G").value = exp.amount;
      row.getCell("G").numFmt = '"-$"#,##0.00';
      
      row.getCell("D").alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      row.getCell("G").alignment = { vertical: "middle", horizontal: "right" };
      row.getCell("G").font = { color: { argb: "FFDC2626" } };
      
      ["D", "E", "F", "G"].forEach(col => {
        row.getCell(col).border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
      });
      
      currentRow++;
    });

    const expTotalRow = sheet.getRow(currentRow);
    expTotalRow.getCell("D").value = "TOTAL GASTOS:";
    sheet.mergeCells(`D${currentRow}:F${currentRow}`);
    expTotalRow.getCell("G").value = liquidation.totalExpenses;
    expTotalRow.getCell("G").numFmt = '"-$"#,##0.00';
    
    ["D", "E", "F"].forEach(col => {
      expTotalRow.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      expTotalRow.getCell(col).font = { bold: true, color: { argb: "FF0F172A" } };
      expTotalRow.getCell(col).border = { top: { style: "medium", color: { argb: "FF94A3B8" } } };
    });
    expTotalRow.getCell("D").alignment = { vertical: "middle", horizontal: "right" };
    
    expTotalRow.getCell("G").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    expTotalRow.getCell("G").font = { bold: true, color: { argb: "FFDC2626" } };
    expTotalRow.getCell("G").alignment = { vertical: "middle", horizontal: "right" };
    expTotalRow.getCell("G").border = { top: { style: "medium", color: { argb: "FF94A3B8" } } };
  }

  // ===================================
  // DESCARGA
  // ===================================
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const fname = filename || `Ventas_Reporte_${toEcuadorDateInput(new Date())}.xlsx`;
  saveAs(blob, fname);
}

export function exportSalesToPdf(sales: SaleExportData[], liquidation: LiquidationData, filename?: string) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(20);
  doc.setTextColor(30);
  doc.text("Reporte de Ventas", 14, 22);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Filtro: ${liquidation.partnerName}`, 14, 28);
  doc.text(`Generado: ${formatEcuadorDateTime(new Date())}`, 14, 34);
  doc.text(`Total tickets: ${sales.length}`, 14, 40);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(30);
  doc.text(`VENTAS BRUTAS: $${liquidation.totalSales.toFixed(2)}`, pageWidth - 14, 28, { align: "right" });
  
  doc.setTextColor(220, 38, 38); // Red
  doc.text(`GASTOS DEDUCIDOS: -$${liquidation.totalExpenses.toFixed(2)}`, pageWidth - 14, 34, { align: "right" });
  
  doc.setTextColor(22, 163, 74); // Green
  doc.text(`LIQUIDACIÓN NETA: $${liquidation.netIncome.toFixed(2)}`, pageWidth - 14, 40, { align: "right" });

  const tableBody = sales.map((s) => [
    s.id.toUpperCase().slice(0, 8),
    s.date,
    s.time,
    s.partner,
    s.products,
    s.method,
    `$${s.total.toFixed(2)}`,
  ]);

  // Add total row to table body
  tableBody.push([
    "SUBTOTAL BRUTO",
    "",
    "",
    "",
    "",
    "",
    `$${liquidation.totalSales.toFixed(2)}`,
  ]);

  autoTable(doc, {
    startY: 48,
    head: [["ID", "Fecha", "Hora", "Socia", "Productos", "Pago", "Total"]],
    body: tableBody,
    theme: "grid",
    headStyles: {
      fillColor: [79, 70, 229], // Indigo 600
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    styles: {
      fontSize: 8,
      cellPadding: 3,
    },
    columnStyles: {
      6: { halign: "right" },
    },
    didParseCell: (data) => {
      if (data.row.index === tableBody.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [240, 240, 240];
      }
    },
  });

  if (liquidation.expensesDetail && liquidation.expensesDetail.length > 0) {
    const finalY = (doc as any).lastAutoTable.finalY + 15;
    
    doc.setFontSize(12);
    doc.setTextColor(30);
    doc.text("Detalle de Gastos Deducidos", 14, finalY);

    const expBody = liquidation.expensesDetail.map(exp => [
      `${formatEcuadorDate(exp.date)} ${formatEcuadorTime(exp.date, {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      exp.description,
      `-$${exp.amount.toFixed(2)}`
    ]);

    // Fila total gastos
    expBody.push([
      "",
      "TOTAL GASTOS",
      `-$${liquidation.totalExpenses.toFixed(2)}`
    ]);

    autoTable(doc, {
      startY: finalY + 5,
      head: [["Fecha y Hora", "Descripción del Gasto", "Monto a Deducir"]],
      body: expBody,
      theme: "grid",
      headStyles: {
        fillColor: [220, 38, 38], // Red 600
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      styles: {
        fontSize: 8,
        cellPadding: 3,
      },
      columnStyles: {
        2: { halign: "right", textColor: [220, 38, 38] },
      },
      didParseCell: (data) => {
        if (data.row.index === expBody.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [254, 242, 242]; // Red 50
        }
      },
    });
  }

  const fname = filename || `Ventas_${toEcuadorDateInput(new Date())}.pdf`;
  doc.save(fname);
}

// ============================================
// CONSOLIDATED DAILY REPORT PDF
// ============================================

export interface ConsolidatedDayData {
  dateLabel: string;
  products: { productName: string; quantity: number; total: number }[];
  expenses: { description: string; amount: number }[];
  totalSales: number;
  totalExpenses: number;
}

export function exportConsolidatedPdf(
  days: ConsolidatedDayData[],
  dateRange: string,
  partnerLabel: string,
  filename?: string,
) {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const m = 8;
  const gap = 6;
  const colW = (pageW - m * 2 - gap) / 2;
  const usableH = pageH - m * 2;
  let col = 0;
  let y = m;

  const ROW_H = 5.0;
  const HEAD_H = 5;
  const TBL_HEAD_H = 5;
  const GASTOS_LBL_H = 4;
  const SUMMARY_H = ROW_H * 3 + 3;

  const xOf = (c: number) => m + c * (colW + gap);

  // Máximo de filas de datos que caben en una columna completa
  const maxRowsPerCol = Math.floor((usableH - HEAD_H - TBL_HEAD_H - SUMMARY_H - 6) / ROW_H) - 1;

  const tblOpts = {
    theme: "grid" as const,
    headStyles: { fillColor: [255, 255, 255] as [number,number,number], textColor: [0,0,0] as [number,number,number], fontStyle: "bold" as const, fontSize: 6.5, cellPadding: 1, lineColor: [0,0,0] as [number,number,number], lineWidth: 0.3 },
    styles: { fontSize: 6.5, cellPadding: 1, lineColor: [0,0,0] as [number,number,number], lineWidth: 0.2, textColor: [0,0,0] as [number,number,number] },
  };

  const salesColStyles = { 0: { halign: "center" as const, cellWidth: 8 }, 1: { halign: "center" as const, cellWidth: 9 }, 2: { cellWidth: "auto" as const }, 3: { halign: "right" as const, cellWidth: 18 } };
  const salesHead = [["ITEM", "CANT", "Etiquetas de fila", partnerLabel.toUpperCase()]];

  // Estima la altura de un día completo (producto + gastos + resumen)
  const estimateH = (day: ConsolidatedDayData) => {
    let h = HEAD_H + TBL_HEAD_H + (day.products.length + 1) * ROW_H;
    if (day.expenses.length > 0) h += GASTOS_LBL_H + TBL_HEAD_H + (day.expenses.length + 1) * ROW_H;
    h += SUMMARY_H + 6;
    return h;
  };

  // Renderiza tabla de gastos + resumen neto en la posición (cx, startY)
  const renderGastosAndSummary = (day: ConsolidatedDayData, cx: number, startY: number) => {
    let curY = startY;
    if (day.expenses.length > 0) {
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "bold");
      doc.text("GASTOS", cx + colW / 2, curY + 3, { align: "center" });
      curY += 4;
      const eb = day.expenses.map((e, i) => [String(i + 1), e.description.toUpperCase(), e.amount.toFixed(2)]);
      eb.push(["", "Total gastos", day.totalExpenses.toFixed(2)]);
      autoTable(doc, { startY: curY, margin: { left: cx, right: pageW - cx - colW }, tableWidth: colW, head: [["#", "Gasto", "Monto"]], body: eb, ...tblOpts, columnStyles: { 0: { halign: "center", cellWidth: 6 }, 2: { halign: "right", cellWidth: 18 } }, didParseCell: (d) => { if (d.row.index === eb.length - 1) d.cell.styles.fontStyle = "bold"; } });
      curY = (doc as any).lastAutoTable.finalY + 1;
    }
    const net = day.totalSales - day.totalExpenses;
    autoTable(doc, { startY: curY, margin: { left: cx, right: pageW - cx - colW }, tableWidth: colW, body: [["TOTAL INGRESOS", day.totalSales.toFixed(2)], ["TOTAL GASTOS", `-${day.totalExpenses.toFixed(2)}`], ["NETO DEL DÍA", net.toFixed(2)]], theme: "grid", styles: { fontSize: 6.5, cellPadding: 1, fontStyle: "bold", lineColor: [0,0,0] as [number,number,number], lineWidth: 0.2, textColor: [0,0,0] as [number,number,number] }, columnStyles: { 0: { cellWidth: "auto" }, 1: { halign: "right", cellWidth: 18 } }, didParseCell: (d) => { if (d.row.index === 1 && d.column.index === 1) d.cell.styles.textColor = [200, 0, 0]; if (d.row.index === 2) d.cell.styles.fillColor = [230, 230, 230]; } });
    return (doc as any).lastAutoTable.finalY;
  };

  for (const day of days) {
    const totalH = estimateH(day);
    const fitsInOneCol = totalH <= usableH;
    const spaceLeft = usableH - (y - m);

    if (fitsInOneCol) {
      // === DÍA CORTO: cabe en una sola columna ===
      if (spaceLeft < totalH) {
        // No cabe aquí, ir al siguiente slot
        if (col === 0) { col = 1; y = m; }
        else { doc.addPage(); col = 0; y = m; }
      }
      const cx = xOf(col);

      // Titulo
      doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
      doc.text(day.dateLabel.toUpperCase(), cx + colW / 2, y + 3, { align: "center" });
      y += 5;

      // Tabla ventas
      const body = day.products.map((p, i) => [String(i + 1), String(p.quantity), p.productName.toUpperCase(), p.total.toFixed(2)]);
      body.push([String(day.products.length + 1), "#N/D", "Total general", day.totalSales.toFixed(2)]);
      autoTable(doc, { startY: y, margin: { left: cx, right: pageW - cx - colW }, tableWidth: colW, head: salesHead, body, ...tblOpts, columnStyles: salesColStyles, didParseCell: (d) => { if (d.row.index === body.length - 1) d.cell.styles.fontStyle = "bold"; } });
      y = (doc as any).lastAutoTable.finalY + 1;

      // Gastos + resumen
      y = renderGastosAndSummary(day, cx, y) + 6;

    } else {
      // === DÍA LARGO: necesita 2 columnas en la misma página ===
      // Siempre empezar en columna izquierda de una página nueva/limpia
      if (col !== 0 || y > m + 2) {
        doc.addPage();
        col = 0;
        y = m;
      }

      // Llenar columna izquierda al máximo primero
      const leftMaxRows = Math.floor((usableH - HEAD_H - TBL_HEAD_H) / ROW_H);
      const leftProducts = Math.min(leftMaxRows, day.products.length);

      const leftItems = day.products.slice(0, leftProducts);
      const rightItems = day.products.slice(leftProducts);

      // --- COLUMNA IZQUIERDA ---
      const cxL = xOf(0);
      doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
      doc.text(day.dateLabel.toUpperCase(), cxL + colW / 2, y + 3, { align: "center" });
      y += 5;

      if (leftItems.length > 0) {
        const bodyL = leftItems.map((p, i) => [String(i + 1), String(p.quantity), p.productName.toUpperCase(), p.total.toFixed(2)]);
        autoTable(doc, { startY: y, margin: { left: cxL, right: pageW - cxL - colW }, tableWidth: colW, head: salesHead, body: bodyL, ...tblOpts, columnStyles: salesColStyles });
      }

      // --- COLUMNA DERECHA ---
      const cxR = xOf(1);
      let yR = m;

      // Continuar numeración
      if (rightItems.length > 0) {
        const bodyR = rightItems.map((p, i) => [String(leftProducts + i + 1), String(p.quantity), p.productName.toUpperCase(), p.total.toFixed(2)]);
        // Fila Total general
        bodyR.push([String(day.products.length + 1), "#N/D", "Total general", day.totalSales.toFixed(2)]);
        autoTable(doc, { startY: yR, margin: { left: cxR, right: pageW - cxR - colW }, tableWidth: colW, head: salesHead, body: bodyR, ...tblOpts, columnStyles: salesColStyles, didParseCell: (d) => { if (d.row.index === bodyR.length - 1) d.cell.styles.fontStyle = "bold"; } });
        yR = (doc as any).lastAutoTable.finalY + 1;
      }

      // Gastos + resumen en columna derecha
      yR = renderGastosAndSummary(day, cxR, yR) + 6;

      // Siguiente día empieza en nueva página
      doc.addPage();
      col = 0;
      y = m;
    }
  }

  // Eliminar última página vacía si la hay
  const pc = doc.getNumberOfPages();

  doc.save(filename || `Resumen_${toEcuadorDateInput(new Date())}.pdf`);
}


// ============================================
// CONSOLIDATED DAILY REPORT EXCEL
// ============================================

export async function exportConsolidatedExcel(
  days: ConsolidatedDayData[],
  partnerLabel: string,
  filename?: string,
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Resumen", {
    views: [{ showGridLines: false }],
  });

  const COLS_PER_BLOCK = 4; // ITEM, CANT, Etiquetas, TOTAL
  const GAP = 1;            // columna separadora
  const MAX_BLOCKS = 4;     // 4 días lado a lado

  // Configurar anchos para los 4 bloques
  for (let b = 0; b < MAX_BLOCKS; b++) {
    const offset = b * (COLS_PER_BLOCK + GAP);
    ws.getColumn(offset + 1).width = 5;   // ITEM
    ws.getColumn(offset + 2).width = 5;   // CANT
    ws.getColumn(offset + 3).width = 38;  // Etiquetas de fila
    ws.getColumn(offset + 4).width = 10;  // TOTAL
    if (b < MAX_BLOCKS - 1) ws.getColumn(offset + 5).width = 1.5; // separador
  }

  const border: Partial<ExcelJS.Borders> = {
    top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" },
  };
  const bFont: Partial<ExcelJS.Font> = { bold: true, size: 8 };
  const nFont: Partial<ExcelJS.Font> = { size: 8 };

  // Escribe un día completo verticalmente en startCol, desde startRow.
  // Retorna la fila final (última fila usada + 1).
  const writeDay = (day: ConsolidatedDayData, startRow: number, startCol: number): number => {
    let r = startRow;
    const c = startCol;

    // Titulo
    ws.mergeCells(r, c, r, c + 3);
    const t = ws.getCell(r, c);
    t.value = day.dateLabel.toUpperCase();
    t.font = { bold: true, size: 9 };
    t.alignment = { horizontal: "center" };
    r++;

    // Cabecera ventas
    ["ITEM", "CANT", "Etiquetas de fila", partnerLabel.toUpperCase()].forEach((h, i) => {
      const cell = ws.getCell(r, c + i);
      cell.value = h;
      cell.font = bFont;
      cell.border = border;
      cell.alignment = { horizontal: i === 3 ? "right" : (i <= 1 ? "center" : "left") };
    });
    r++;

    // Productos
    day.products.forEach((p, idx) => {
      [idx + 1, p.quantity, p.productName.toUpperCase(), p.total].forEach((v, i) => {
        const cell = ws.getCell(r, c + i);
        cell.value = v;
        cell.font = nFont;
        cell.border = border;
        cell.alignment = { horizontal: i === 3 ? "right" : (i <= 1 ? "center" : "left") };
        if (i === 3 && typeof v === "number") cell.numFmt = "#,##0.00";
      });
      r++;
    });

    // Total general
    [day.products.length + 1, "#N/D", "Total general", day.totalSales].forEach((v, i) => {
      const cell = ws.getCell(r, c + i);
      cell.value = v;
      cell.font = bFont;
      cell.border = border;
      cell.alignment = { horizontal: i === 3 ? "right" : (i <= 1 ? "center" : "left") };
      if (i === 3 && typeof v === "number") cell.numFmt = "#,##0.00";
    });
    r++;

    // Gastos
    if (day.expenses.length > 0) {
      ws.mergeCells(r, c, r, c + 3);
      ws.getCell(r, c).value = "GASTOS";
      ws.getCell(r, c).font = bFont;
      ws.getCell(r, c).alignment = { horizontal: "center" };
      r++;

      // Cabecera gastos
      ["#", "Gasto", "", "Monto"].forEach((h, i) => {
        const cell = ws.getCell(r, c + i);
        cell.value = h || undefined;
        cell.font = bFont;
        cell.border = border;
      });
      ws.mergeCells(r, c + 1, r, c + 2);
      r++;

      day.expenses.forEach((e, idx) => {
        ws.getCell(r, c).value = idx + 1;
        ws.getCell(r, c).font = nFont;
        ws.getCell(r, c).border = border;
        ws.getCell(r, c).alignment = { horizontal: "center" };
        ws.mergeCells(r, c + 1, r, c + 2);
        ws.getCell(r, c + 1).value = e.description.toUpperCase();
        ws.getCell(r, c + 1).font = nFont;
        ws.getCell(r, c + 1).border = border;
        ws.getCell(r, c + 3).value = e.amount;
        ws.getCell(r, c + 3).font = nFont;
        ws.getCell(r, c + 3).border = border;
        ws.getCell(r, c + 3).numFmt = "#,##0.00";
        ws.getCell(r, c + 3).alignment = { horizontal: "right" };
        r++;
      });

      // Total gastos
      ws.mergeCells(r, c, r, c + 2);
      ws.getCell(r, c).value = "Total gastos";
      ws.getCell(r, c).font = bFont;
      ws.getCell(r, c).border = border;
      ws.getCell(r, c + 3).value = day.totalExpenses;
      ws.getCell(r, c + 3).font = bFont;
      ws.getCell(r, c + 3).border = border;
      ws.getCell(r, c + 3).numFmt = "#,##0.00";
      ws.getCell(r, c + 3).alignment = { horizontal: "right" };
      r++;
    }

    // Resumen neto
    const net = day.totalSales - day.totalExpenses;
    ([[" TOTAL INGRESOS", day.totalSales], ["TOTAL GASTOS", -day.totalExpenses], ["NETO DEL DÍA", net]] as [string, number][]).forEach(([label, val], idx) => {
      ws.mergeCells(r, c, r, c + 2);
      const lbl = ws.getCell(r, c);
      lbl.value = label;
      lbl.font = bFont;
      lbl.border = border;
      const vCell = ws.getCell(r, c + 3);
      vCell.value = val;
      vCell.font = { ...bFont, color: idx === 1 ? { argb: "FFCC0000" } : undefined };
      vCell.border = border;
      vCell.numFmt = "#,##0.00";
      vCell.alignment = { horizontal: "right" };
      if (idx === 2) {
        lbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6E6E6" } };
        vCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6E6E6" } };
      }
      r++;
    });

    return r;
  };

  // Colocar días: 4 lado a lado, nueva fila cuando se llenan las 4 columnas
  let blockIdx = 0;
  let rowStart = 1;
  let maxRowEnd = 1;

  for (const day of days) {
    const colSlot = blockIdx % MAX_BLOCKS;
    const startCol = colSlot * (COLS_PER_BLOCK + GAP) + 1;

    if (colSlot === 0 && blockIdx > 0) {
      rowStart = maxRowEnd + 2; // 2 filas de separación entre filas de bloques
      maxRowEnd = rowStart;
    }

    const endRow = writeDay(day, rowStart, startCol);
    if (endRow > maxRowEnd) maxRowEnd = endRow;
    blockIdx++;
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, filename || `Resumen_${toEcuadorDateInput(new Date())}.xlsx`);
}

