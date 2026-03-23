/**
 * @file inventario/migracion/page.tsx
 * @description Importacion de inventario desde 2 archivos Excel de Sheyla:
 *   - INVEN.xlsx   → diccionario de BARRAS (barcode) indexado por Codigo
 *   - INV17*.xlsx  → inventario real con Stock, Codigo, Nombre, PVP, Marca
 *
 * Flujo:
 * 1. Cargar INVEN.xlsx (diccionario de barras)
 * 2. Cargar INV17*.xlsx (inventario con stock)
 * 3. Cruzar Codigo → BARRAS
 * 4. Filtrar solo Rosa, Yadira, Lorena, Medias
 * 5. Importar con upsert_product_with_movement usando BARRAS como barcode y Codigo como SKU
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileSpreadsheet,
  Loader2,
  Upload,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
} from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getMigrationExistingProductsLocalFirst,
  getMigrationPartnersLocalFirst,
  importMigrationProductLocalFirst,
} from "@/lib/local/migration-import";
import type { Partner } from "@/types/database";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────

type BarcodeDictEntry = { barras: string; marca: string };

interface ExistingProduct {
  id: string;
  barcode: string;
  sku?: string | null;
}

type ExistingMatch = "none" | "barcode" | "sku" | "barcode_and_sku";

interface PreparedProduct extends MappedProduct {
  blockingErrors: string[];
  warningErrors: string[];
  existingMatch: ExistingMatch;
  existingProductId: string | null;
}

interface MappedProduct {
  row: number;
  codigo: string;
  barcode: string; // BARRAS from dictionary
  name: string;
  owner: string;
  ownerKey: string;
  ownerId: string;
  salePrice: number;
  stock: number;
  minStock: number;
  ignored: boolean;
  ignoreReason: string | null;
  errors: string[];
}

// ── Constants ────────────────────────────────────────────────

const TARGET_OWNERS = new Set(["rosa", "yadira", "lorena", "todos"]);
const IGNORED_OWNERS = new Set([
  "miguel",
  "diana",
  "edison",
  "marcagenerica",
  "categoriageneral",
]);

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeLookupKey(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function getBlockingErrors(errors: string[]): string[] {
  return errors.filter((error) => !error.includes("Sin BARRAS"));
}

function getExistingMatchLabel(match: ExistingMatch): string {
  switch (match) {
    case "barcode":
      return "por codigo de barras";
    case "sku":
      return "por SKU";
    case "barcode_and_sku":
      return "por codigo de barras y SKU";
    default:
      return "";
  }
}

// ── Parse INVEN.xlsx (barcode dictionary) ─────────────────

function parseBarcodeDict(file: ArrayBuffer): Map<string, BarcodeDictEntry> {
  const wb = XLSX.read(file, { type: "array" });
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(
    wb.Sheets[wb.SheetNames[0]],
    { header: 1, defval: "" }
  );

  // Header at row 5: Codigo[0] BARRAS[1] Categoria[2] Marca[3] ... Nombre[5] ... PVP[8]
  const map = new Map<string, BarcodeDictEntry>();
  for (let i = 6; i < rows.length; i++) {
    const r = rows[i];
    const codigo = String(r[0] || "").trim();
    const barras = String(r[1] || "").trim();
    const marca = String(r[3] || "").trim();
    if (codigo && barras && barras !== "0") {
      map.set(codigo.toLowerCase(), { barras, marca });
    }
  }
  return map;
}

// ── Parse INV17*.xlsx (inventory with stock) ──────────────

function parseInventoryFile(file: ArrayBuffer): {
  rows: Record<string, unknown>[];
  totalRaw: number;
} {
  const wb = XLSX.read(file, { type: "array" });
  const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(
    wb.Sheets[wb.SheetNames[0]],
    { header: 1, defval: "" }
  );

  // Header at row 5: ...[0] No.[1] Código[2] Stock[3] Uni.[4] Producto[5]
  //                   0-StockPercha[6] Categoria[7] Marca[8] Obs[9] CostoSINIVA[10] PVP[11]
  const results: Record<string, unknown>[] = [];
  for (let i = 6; i < raw.length; i++) {
    const r = raw[i];
    const codigo = String(r[2] || "").trim();
    const nombre = String(r[5] || "").trim();
    if (!codigo && !nombre) continue; // skip footer/empty

    results.push({
      __row__: i + 1,
      codigo,
      stock: Number(r[3] || 0),
      nombre,
      categoria: String(r[7] || "").trim(),
      marca: String(r[8] || "").trim(),
      pvp: Number(r[11] || 0),
    });
  }
  return { rows: results, totalRaw: raw.length };
}

// ── Map to import-ready products ──────────────────────────

function mapProducts(
  invRows: Record<string, unknown>[],
  barcodeDict: Map<string, BarcodeDictEntry>,
  partners: Partner[],
  defaultOwnerId: string,
  defaultMinStock: number
): MappedProduct[] {
  return invRows.map((r) => {
    const row = Number(r.__row__);
    const codigo = String(r.codigo || "");
    const nombre = String(r.nombre || "");
    const rawStock = Number(r.stock || 0);
    const stock = Number.isFinite(rawStock) ? Math.trunc(rawStock) : 0;
    const pvp = Number(r.pvp || 0);
    const marca = String(r.marca || "");
    const ownerKey = norm(marca);
    const errors: string[] = [];

    // Resolve barcode from dictionary
    const dictEntry = barcodeDict.get(codigo.toLowerCase());
    const barcode = dictEntry?.barras || codigo; // fallback to codigo if not found

    // Check if ignored owner
    if (IGNORED_OWNERS.has(ownerKey)) {
      return {
        row, codigo, barcode, name: nombre, owner: marca, ownerKey,
        ownerId: "", salePrice: pvp, stock, minStock: defaultMinStock,
        ignored: true, ignoreReason: `Socio ignorado: ${marca}`,
        errors: [],
      };
    }

    // Resolve partner
    let ownerId = "";
    if (TARGET_OWNERS.has(ownerKey)) {
      const found = partners.find(
        (p) => norm(p.name) === ownerKey || norm(p.display_name) === ownerKey
      );
      if (found) ownerId = found.id;
    }

    if (!ownerId && defaultOwnerId) {
      ownerId = defaultOwnerId;
    }

    // Validation
    if (!barcode) errors.push("Sin codigo de barras");
    if (!nombre) errors.push("Sin nombre");
    if (pvp <= 0) errors.push("Precio invalido");
    if (rawStock < 0) errors.push("Stock negativo");
    if (!ownerId) errors.push("Socia no definida");
    if (!dictEntry) errors.push("Sin BARRAS en diccionario (usa Codigo)");

    return {
      row, codigo, barcode, name: nombre, owner: marca, ownerKey,
      ownerId, salePrice: pvp, stock, minStock: defaultMinStock,
      ignored: false, ignoreReason: null, errors,
    };
  });
}

// ── Component ────────────────────────────────────────────────

export default function InventarioMigracionPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [existingProducts, setExistingProducts] = useState<ExistingProduct[]>([]);

  // Barcode dictionary (INVEN.xlsx)
  const [barcodeDict, setBarcodeDict] = useState<Map<string, BarcodeDictEntry>>(new Map());
  const [dictFileName, setDictFileName] = useState("");
  const [dictCount, setDictCount] = useState(0);

  // Inventory file (INV17*.xlsx)
  const [invRows, setInvRows] = useState<Record<string, unknown>[]>([]);
  const [invFileName, setInvFileName] = useState("");

  // Config
  const [defaultOwnerId, setDefaultOwnerId] = useState("");
  const [defaultMinStock, setDefaultMinStock] = useState("2");

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [summary, setSummary] = useState<{
    created: number;
    existing: number;
    failed: number;
    ignored: number;
    errors: string[];
  } | null>(null);

  // ── Fetch context ──────────

  const fetchContext = useCallback(async () => {
    try {
      const partnerData = await getMigrationPartnersLocalFirst();
      setPartners(partnerData);
      if (!defaultOwnerId && partnerData.length > 0) {
        setDefaultOwnerId(partnerData[0].id);
      }

      const allExisting = await getMigrationExistingProductsLocalFirst();
      setExistingProducts(allExisting);
    } catch (err) {
      console.error("[Migration] fetchContext error:", err);
      toast.error("No se pudo cargar contexto");
    }
  }, [defaultOwnerId]);

  useEffect(() => {
    fetchContext();
  }, [fetchContext]);

  // ── Mapped preview ─────────

  const mapped = useMemo<PreparedProduct[]>(() => {
    if (invRows.length === 0) return [];
    const minStock = Math.max(parseInt(defaultMinStock, 10) || 0, 0);
    const baseProducts = mapProducts(invRows, barcodeDict, partners, defaultOwnerId, minStock);

    const existingByBarcode = new Map<string, ExistingProduct>();
    const existingBySku = new Map<string, ExistingProduct>();

    for (const product of existingProducts) {
      const barcodeKey = normalizeLookupKey(product.barcode);
      if (barcodeKey) existingByBarcode.set(barcodeKey, product);

      const skuKey = normalizeLookupKey(product.sku);
      if (skuKey) existingBySku.set(skuKey, product);
    }

    return baseProducts.map((product) => {
      const blockingErrors = getBlockingErrors(product.errors);
      const warningErrors = product.errors.filter((error) => error.includes("Sin BARRAS"));
      const barcodeMatch = existingByBarcode.get(normalizeLookupKey(product.barcode));
      const skuMatch = existingBySku.get(normalizeLookupKey(product.codigo));

      if (barcodeMatch && skuMatch) {
        if (barcodeMatch.id === skuMatch.id) {
          return {
            ...product,
            blockingErrors,
            warningErrors,
            existingMatch: "barcode_and_sku",
            existingProductId: barcodeMatch.id,
          };
        }

        return {
          ...product,
          blockingErrors: [
            ...blockingErrors,
            "Conflicto: el codigo de barras y el SKU ya existen en productos distintos",
          ],
          warningErrors,
          existingMatch: "none",
          existingProductId: null,
        };
      }

      if (barcodeMatch) {
        return {
          ...product,
          blockingErrors,
          warningErrors,
          existingMatch: "barcode",
          existingProductId: barcodeMatch.id,
        };
      }

      if (skuMatch) {
        return {
          ...product,
          blockingErrors,
          warningErrors,
          existingMatch: "sku",
          existingProductId: skuMatch.id,
        };
      }

      return {
        ...product,
        blockingErrors,
        warningErrors,
        existingMatch: "none",
        existingProductId: null,
      };
    });
  }, [invRows, barcodeDict, partners, defaultOwnerId, defaultMinStock, existingProducts]);

  const stats = useMemo(() => {
    const toImport = mapped.filter(
      (m) => !m.ignored && m.blockingErrors.length === 0 && m.existingMatch === "none"
    );
    const existing = mapped.filter(
      (m) => !m.ignored && m.blockingErrors.length === 0 && m.existingMatch !== "none"
    );
    const toIgnore = mapped.filter((m) => m.ignored);
    const withErrors = mapped.filter((m) => !m.ignored && m.blockingErrors.length > 0);
    const withoutBarras = mapped.filter((m) => !m.ignored && m.warningErrors.length > 0);
    return {
      toImport: toImport.length,
      existing: existing.length,
      toIgnore: toIgnore.length,
      withErrors: withErrors.length,
      withoutBarras: withoutBarras.length,
    };
  }, [mapped]);

  // ── File handlers ──────────

  const handleDictFile = async (file: File | null) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const dict = parseBarcodeDict(buffer);
      setBarcodeDict(dict);
      setDictFileName(file.name);
      setDictCount(dict.size);
      toast.success(`Diccionario cargado: ${dict.size} codigos con BARRAS`);
    } catch {
      toast.error("No se pudo leer el archivo de diccionario");
    }
  };

  const handleInvFile = async (file: File | null) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const { rows } = parseInventoryFile(buffer);
      setInvRows(rows);
      setInvFileName(file.name);
      setSummary(null);
      setProgress({ current: 0, total: rows.length });
      toast.success(`Inventario cargado: ${rows.length} productos`);
    } catch {
      toast.error("No se pudo leer el archivo de inventario");
    }
  };

  // ── Import ─────────────────

  const handleImport = async () => {
    if (barcodeDict.size === 0) {
      toast.error("Carga primero el diccionario de BARRAS (INVEN.xlsx)");
      return;
    }
    if (invRows.length === 0) {
      toast.error("Carga el archivo de inventario");
      return;
    }
    if (partners.length === 0) {
      toast.error("No hay socias registradas. Ejecuta la migracion SQL primero.");
      return;
    }

    const products = mapped.filter(
      (product) =>
        !product.ignored &&
        product.blockingErrors.length === 0 &&
        product.existingMatch === "none"
    );

    if (products.length === 0) {
      toast.info("No hay productos faltantes para importar");
      return;
    }

    const barcodeMap = new Map(
      existingProducts
        .map((product) => [normalizeLookupKey(product.barcode), product] as const)
        .filter(([key]) => key)
    );
    const skuMap = new Map(
      existingProducts
        .map((product) => [normalizeLookupKey(product.sku), product] as const)
        .filter(([key]) => key)
    );

    let created = 0;
    let existing = stats.existing;
    let failed = 0;
    let ignored = stats.toIgnore;
    const errors: string[] = [];

    setIsImporting(true);
    setSummary(null);
    setProgress({ current: 0, total: products.length });

    for (let i = 0; i < products.length; i++) {
      const m = products[i];

      try {
        const barcodeKey = normalizeLookupKey(m.barcode);
        const skuKey = normalizeLookupKey(m.codigo);
        const alreadyExisting =
          (barcodeKey && barcodeMap.get(barcodeKey)) ||
          (skuKey && skuMap.get(skuKey));

        if (alreadyExisting) {
          existing++;
          continue;
        }

        const result = await importMigrationProductLocalFirst({
          barcode: m.barcode,
          sku: m.codigo,
          name: m.name,
          description: null,
          ownerId: m.ownerId,
          salePrice: m.salePrice,
          stock: m.stock,
          minStock: m.minStock,
        });
        const productId = String(result?.productId || "");

        created++;

        if (productId) {
          const nextProduct: ExistingProduct = {
            id: productId,
            barcode: m.barcode,
            sku: m.codigo,
          };

          if (barcodeKey) barcodeMap.set(barcodeKey, nextProduct);
          if (skuKey) skuMap.set(skuKey, nextProduct);
        }
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : "Error desconocido";
        if (errors.length < 25) {
          errors.push(`Fila ${m.row}: ${message}`);
        }
      } finally {
        setProgress({ current: i + 1, total: products.length });
      }
    }

    setSummary({ created, existing, failed, ignored, errors });
    setIsImporting(false);
    await fetchContext();

    if (failed > 0) {
      toast.warning("Importacion finalizada con observaciones", {
        description: `Creados: ${created}, ya existian: ${existing}, ignorados: ${ignored}, fallidos: ${failed}`,
      });
    } else {
      toast.success("Importacion completada", {
        description: `Creados: ${created}, ya existian: ${existing}, ignorados: ${ignored}`,
      });
    }
  };

  // ── Render ─────────────────

  return (
    <div className="flex flex-col h-full gap-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900">
          <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
          Migracion de Inventario
        </h1>
        <p className="text-sm text-slate-500">
          Importa desde Sheyla usando 2 archivos: el reporte de productos (BARRAS) y el inventario (Stock).
          Solo se importan Rosa, Yadira, Lorena y Medias.
        </p>
      </div>

      {/* Step 1 & 2: File inputs */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* Dictionary file */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-500" />
              Paso 1: Reporte de Productos (tiene BARRAS)
            </Label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleDictFile(e.target.files?.[0] ?? null)}
              className="bg-white border-slate-200 shadow-sm"
            />
            {dictFileName ? (
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-emerald-700 font-medium">{dictFileName}</span>
                <Badge variant="outline" className="text-[10px]">{dictCount} codigos</Badge>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Normalmente se llama INVEN.xlsx</p>
            )}
          </div>

          {/* Inventory file */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
              Paso 2: Inventario de Productos (tiene Stock)
            </Label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleInvFile(e.target.files?.[0] ?? null)}
              className="bg-white border-slate-200 shadow-sm"
            />
            {invFileName ? (
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-emerald-700 font-medium">{invFileName}</span>
                <Badge variant="outline" className="text-[10px]">{invRows.length} productos</Badge>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Normalmente se llama INV17032026.xlsx</p>
            )}
          </div>
        </div>

        {/* Config */}
        <div className="grid gap-3 md:grid-cols-[1fr_200px_auto]">
          <div className="space-y-1">
            <Label htmlFor="default-owner">Socia por defecto</Label>
            <select
              id="default-owner"
              value={defaultOwnerId}
              onChange={(e) => setDefaultOwnerId(e.target.value)}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20"
            >
              <option value="">Sin socia por defecto</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="default-minstock">Stock minimo</Label>
            <Input
              id="default-minstock"
              type="number"
              min="0"
              value={defaultMinStock}
              onChange={(e) => setDefaultMinStock(e.target.value)}
              className="font-mono bg-white border-slate-200 shadow-sm h-9"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleImport}
              disabled={isImporting || invRows.length === 0 || barcodeDict.size === 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 border-0 h-9"
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {progress.current}/{progress.total}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Importar faltantes
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Stats bar */}
        {mapped.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              Faltantes a importar: {stats.toImport}
            </Badge>
            <Badge variant="outline" className="gap-1 text-blue-700 border-blue-200">
              <Database className="h-3 w-3 text-blue-500" />
              Ya existen: {stats.existing}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <XCircle className="h-3 w-3 text-slate-400" />
              Ignorados: {stats.toIgnore}
            </Badge>
            {stats.withErrors > 0 && (
              <Badge variant="outline" className="gap-1 text-rose-600 border-rose-200">
                <AlertTriangle className="h-3 w-3" />
                Con errores: {stats.withErrors}
              </Badge>
            )}
            {stats.withoutBarras > 0 && (
              <Badge variant="outline" className="gap-1 text-amber-600 border-amber-200">
                <AlertTriangle className="h-3 w-3" />
                Sin BARRAS: {stats.withoutBarras}
              </Badge>
            )}
            <Badge variant="outline">Productos en BD: {existingProducts.length}</Badge>
          </div>
        )}
      </div>

      {/* Preview & Results */}
      <div className="grid gap-4 md:grid-cols-2 min-h-0 flex-1">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex flex-col min-h-0">
          <h2 className="text-sm font-semibold mb-2 text-slate-900">
            Preview ({Math.min(mapped.length, 10)} de {mapped.length})
          </h2>
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-2">
              {mapped.length === 0 ? (
                <p className="text-xs text-slate-500">Carga ambos archivos para ver preview.</p>
              ) : (
                mapped.slice(0, 10).map((m, i) => (
                  <div
                    key={`${m.codigo}-${i}`}
                    className={`rounded-md border p-2 text-xs space-y-0.5 ${
                      m.ignored
                        ? "border-slate-200 bg-slate-50"
                        : m.blockingErrors.length > 0
                        ? "border-rose-200 bg-rose-50"
                        : m.existingMatch !== "none"
                        ? "border-blue-200 bg-blue-50"
                        : "border-emerald-200 bg-emerald-50"
                    }`}
                  >
                    <p className="font-medium text-slate-900">{m.name || "(sin nombre)"}</p>
                    <p className="text-slate-600">
                      SKU: <span className="font-mono">{m.codigo}</span> → BARRAS: <span className="font-mono font-semibold">{m.barcode}</span>
                    </p>
                    <p className="text-slate-600">
                      Stock: {m.stock} · PVP: ${m.salePrice.toFixed(2)} · Dueño: {m.owner}
                    </p>
                    {m.ignored && (
                      <p className="text-amber-600 font-medium">{m.ignoreReason}</p>
                    )}
                    {!m.ignored && m.blockingErrors.length > 0 && (
                      <p className="text-rose-600 font-medium">{m.blockingErrors.join(", ")}</p>
                    )}
                    {!m.ignored && m.blockingErrors.length === 0 && m.existingMatch !== "none" && (
                      <p className="text-blue-700 font-medium">
                        Ya existe en inventario ({getExistingMatchLabel(m.existingMatch)})
                      </p>
                    )}
                    {!m.ignored && m.blockingErrors.length === 0 && m.existingMatch === "none" && (
                      <p className="text-emerald-600 font-medium">Listo para importar faltante</p>
                    )}
                    {!m.ignored && m.warningErrors.length > 0 && (
                      <p className="text-amber-700 font-medium">{m.warningErrors.join(", ")}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 flex flex-col min-h-0">
          <h2 className="text-sm font-semibold mb-2 text-slate-900">Resultado de importacion</h2>
          <ScrollArea className="flex-1 min-h-0">
            {!summary ? (
              <p className="text-xs text-slate-500">Aun no se ha ejecutado una importacion.</p>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-center">
                    <p className="text-lg font-bold text-emerald-700">{summary.created}</p>
                    <p className="text-emerald-600">Creados</p>
                  </div>
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-center">
                    <p className="text-lg font-bold text-blue-700">{summary.existing}</p>
                    <p className="text-blue-600">Ya existian</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-center">
                    <p className="text-lg font-bold text-slate-700">{summary.ignored}</p>
                    <p className="text-slate-600">Ignorados</p>
                  </div>
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-center">
                    <p className="text-lg font-bold text-rose-700">{summary.failed}</p>
                    <p className="text-rose-600">Fallidos</p>
                  </div>
                </div>
                {summary.errors.length > 0 && (
                  <div className="pt-2 space-y-1">
                    <p className="font-medium text-slate-900">Errores:</p>
                    {summary.errors.map((e) => (
                      <p key={e} className="text-rose-600">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
