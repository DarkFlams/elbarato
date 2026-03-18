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
  sheet.getCell("B3").value = new Date().toLocaleString("es-EC");

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
  const fname = filename || `Ventas_Reporte_${new Date().toISOString().split("T")[0]}.xlsx`;
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
  doc.text(`Generado: ${new Date().toLocaleString("es-EC")}`, 14, 34);
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
      new Date(exp.date).toLocaleDateString("es-EC") + " " + new Date(exp.date).toLocaleTimeString("es-EC", { hour: '2-digit', minute: '2-digit' }),
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

  const fname = filename || `Ventas_${new Date().toISOString().split("T")[0]}.pdf`;
  doc.save(fname);
}
