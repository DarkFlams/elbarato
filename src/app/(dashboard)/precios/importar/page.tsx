"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Tags,
  Upload,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getMigrationCatalogProductsLocalFirst,
  updateMigrationProductPricesLocalFirst,
  type MigrationCatalogProductSnapshot,
} from "@/lib/local/migration-import";
import { formatPriceValue } from "@/lib/pricing";
import { cn } from "@/lib/utils";

interface PriceSheetRow {
  row: number;
  codigo: string;
  owner: string;
  stock: number;
  name: string;
  salePrice: number;
  salePriceX3: number | null;
  salePriceX6: number | null;
  salePriceX12: number | null;
  errors: string[];
}

type PriceMatchType = "none" | "sku" | "barcode";

interface PreparedPriceUpdate extends PriceSheetRow {
  blockingErrors: string[];
  matchedBy: PriceMatchType;
  product: MigrationCatalogProductSnapshot | null;
  willChange: boolean;
}

function normalizeLookupKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeInventoryInteger(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

function normalizePriceCell(value: unknown, allowNull: boolean) {
  if (value === null || value === undefined) {
    return allowNull ? null : 0;
  }

  const raw = String(value).trim();
  if (!raw || raw === "-") {
    return allowNull ? null : 0;
  }

  const parsed =
    typeof value === "number"
      ? value
      : Number(raw.replace(/\s+/g, "").replace(/,/g, "."));

  if (!Number.isFinite(parsed)) {
    return allowNull ? null : 0;
  }

  return Number(parsed.toFixed(2));
}

function sameNullablePrice(a: number | null, b: number | null) {
  return (a ?? null) === (b ?? null);
}

function parsePriceFile(file: ArrayBuffer): PriceSheetRow[] {
  const workbook = XLSX.read(file, { type: "array" });
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(
    workbook.Sheets[workbook.SheetNames[0]],
    { header: 1, defval: "" }
  );

  const results: PriceSheetRow[] = [];

  for (let index = 6; index < rows.length; index += 1) {
    const row = rows[index];
    const codigo = String(row[1] || "").trim();
    const owner = String(row[3] || "").trim();
    const stockValue = Number(row[4] || 0);
    const name = String(row[5] || "").trim();

    if (!codigo && !name) continue;

    const salePrice = normalizePriceCell(row[6], false) ?? 0;
    const salePriceX12 = normalizePriceCell(row[7], true);
    const salePriceX3 = normalizePriceCell(row[8], true);
    const salePriceX6 = normalizePriceCell(row[9], true);
    const errors: string[] = [];

    if (!codigo) errors.push("Sin codigo");
    if (!name) errors.push("Sin nombre");
    if (salePrice <= 0) errors.push("Precio normal invalido");
    if (stockValue < 0) errors.push("Stock negativo");

    results.push({
      row: index + 1,
      codigo,
      owner,
      stock: normalizeInventoryInteger(stockValue),
      name,
      salePrice,
      salePriceX3,
      salePriceX6,
      salePriceX12,
      errors,
    });
  }

  return results;
}

function formatPreviewPrices(row: PriceSheetRow) {
  return [
    `N ${formatPriceValue(row.salePrice)}`,
    `x3 ${formatPriceValue(row.salePriceX3)}`,
    `x6 ${formatPriceValue(row.salePriceX6)}`,
    `x12 ${formatPriceValue(row.salePriceX12)}`,
  ].join(" | ");
}

export default function ImportarPreciosPage() {
  const [catalogProducts, setCatalogProducts] = useState<
    MigrationCatalogProductSnapshot[]
  >([]);
  const [priceRows, setPriceRows] = useState<PriceSheetRow[]>([]);
  const [priceFileName, setPriceFileName] = useState("");
  const [syncStockFromFile, setSyncStockFromFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [summary, setSummary] = useState<{
    updated: number;
    unchanged: number;
    invalid: number;
    failed: number;
    errors: string[];
  } | null>(null);

  const fetchCatalog = useCallback(async () => {
    try {
      const products = await getMigrationCatalogProductsLocalFirst();
      setCatalogProducts(products);
    } catch (error) {
      console.error("[PriceImport] fetchCatalog error:", error);
      toast.error("No se pudo cargar el inventario actual");
    }
  }, []);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  const preparedUpdates = useMemo<PreparedPriceUpdate[]>(() => {
    if (priceRows.length === 0) return [];

    const productsBySku = new Map<string, MigrationCatalogProductSnapshot>();
    const productsByBarcode = new Map<string, MigrationCatalogProductSnapshot>();

    for (const product of catalogProducts) {
      const skuKey = normalizeLookupKey(product.sku);
      const barcodeKey = normalizeLookupKey(product.barcode);
      if (skuKey) productsBySku.set(skuKey, product);
      if (barcodeKey) productsByBarcode.set(barcodeKey, product);
    }

    return priceRows.map((row) => {
      const blockingErrors = [...row.errors];
      const codeKey = normalizeLookupKey(row.codigo);
      const matchedBySku = codeKey ? productsBySku.get(codeKey) ?? null : null;
      const matchedByBarcode = codeKey
        ? productsByBarcode.get(codeKey) ?? null
        : null;
      const product = matchedBySku ?? matchedByBarcode ?? null;
      const matchedBy: PriceMatchType = matchedBySku
        ? "sku"
        : matchedByBarcode
          ? "barcode"
          : "none";

      if (!product) {
        blockingErrors.push("Codigo/SKU no encontrado en el inventario actual");
      }

      const nextStock = syncStockFromFile ? row.stock : product?.stock ?? 0;
      const willChange = Boolean(
        product &&
          (
            product.salePrice !== row.salePrice ||
            !sameNullablePrice(product.salePriceX3, row.salePriceX3) ||
            !sameNullablePrice(product.salePriceX6, row.salePriceX6) ||
            !sameNullablePrice(product.salePriceX12, row.salePriceX12) ||
            nextStock !== product.stock
          )
      );

      return {
        ...row,
        blockingErrors,
        matchedBy,
        product,
        willChange,
      };
    });
  }, [catalogProducts, priceRows, syncStockFromFile]);

  const stats = useMemo(() => {
    const ready = preparedUpdates.filter(
      (row) => row.blockingErrors.length === 0 && row.willChange
    ).length;
    const unchanged = preparedUpdates.filter(
      (row) => row.blockingErrors.length === 0 && !row.willChange
    ).length;
    const invalid = preparedUpdates.filter(
      (row) => row.blockingErrors.length > 0
    ).length;

    return {
      ready,
      unchanged,
      invalid,
    };
  }, [preparedUpdates]);

  const handlePriceFile = async (file: File | null) => {
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const rows = parsePriceFile(buffer);
      setPriceRows(rows);
      setPriceFileName(file.name);
      setSummary(null);
      setProgress({ current: 0, total: rows.length });
      toast.success(`Archivo de precios cargado: ${rows.length} filas`);
    } catch (error) {
      console.error("[PriceImport] parse error:", error);
      toast.error("No se pudo leer el archivo de precios");
    }
  };

  const handleImport = async () => {
    if (priceRows.length === 0) {
      toast.error("Carga primero el archivo de precios");
      return;
    }

    if (catalogProducts.length === 0) {
      toast.error("No hay inventario cargado para cruzar precios");
      return;
    }

    const readyRows = preparedUpdates.filter(
      (row) => row.blockingErrors.length === 0
    );

    if (readyRows.length === 0) {
      toast.info("No hay filas validas para actualizar");
      return;
    }

    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    const invalid = preparedUpdates.filter(
      (row) => row.blockingErrors.length > 0
    ).length;
    const errors: string[] = [];

    setIsImporting(true);
    setSummary(null);
    setProgress({ current: 0, total: readyRows.length });

    for (let index = 0; index < readyRows.length; index += 1) {
      const row = readyRows[index];

      try {
        if (!row.product) {
          failed += 1;
          continue;
        }

        const nextStock = syncStockFromFile ? row.stock : row.product.stock;
        const noChanges =
          !row.willChange ||
          (
            row.product.salePrice === row.salePrice &&
            sameNullablePrice(row.product.salePriceX3, row.salePriceX3) &&
            sameNullablePrice(row.product.salePriceX6, row.salePriceX6) &&
            sameNullablePrice(row.product.salePriceX12, row.salePriceX12) &&
            nextStock === row.product.stock
          );

        if (noChanges) {
          unchanged += 1;
          continue;
        }

        await updateMigrationProductPricesLocalFirst({
          productId: row.product.id,
          barcode: row.product.barcode,
          sku: row.product.sku ?? null,
          name: row.product.name,
          description: row.product.description ?? null,
          ownerId: row.product.ownerId,
          purchasePrice: row.product.purchasePrice,
          salePrice: row.salePrice,
          salePriceX3: row.salePriceX3,
          salePriceX6: row.salePriceX6,
          salePriceX12: row.salePriceX12,
          stock: nextStock,
          minStock: row.product.minStock,
          isActive: row.product.isActive,
        });

        updated += 1;
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : "Error desconocido";
        if (errors.length < 25) {
          errors.push(`Fila ${row.row}: ${message}`);
        }
      } finally {
        setProgress({ current: index + 1, total: readyRows.length });
      }
    }

    setSummary({ updated, unchanged, invalid, failed, errors });
    setIsImporting(false);
    await fetchCatalog();

    if (failed > 0) {
      toast.warning("Actualizacion de precios finalizada con observaciones", {
        description: `Actualizados: ${updated}, sin cambios: ${unchanged}, invalidos: ${invalid}, fallidos: ${failed}`,
      });
      return;
    }

    toast.success("Precios actualizados", {
      description: `Actualizados: ${updated}, sin cambios: ${unchanged}, invalidos: ${invalid}`,
    });
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Tags className="h-5 w-5 text-slate-700" />
            Importar Lista de Precios
          </h1>
          <p className="text-sm text-slate-500">
            Actualiza PVP normal, x3, x6 y x12 desde `precios.xlsx` sin tocar la
            migracion vieja de inventario.
          </p>
        </div>

        <Link
          href="/precios"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "border-slate-200 bg-white shadow-sm"
          )}
        >
          Volver a precios
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
              Archivo de lista de precios
            </Label>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => handlePriceFile(event.target.files?.[0] ?? null)}
              className="border-slate-200 bg-white shadow-sm"
            />
            {priceFileName ? (
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span className="font-medium text-emerald-700">{priceFileName}</span>
                <Badge variant="outline" className="text-[10px]">
                  {priceRows.length} filas
                </Badge>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Usa `docs/Inventario/precios.xlsx`
              </p>
            )}
          </div>

          <div className="flex flex-col justify-end gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={syncStockFromFile}
                onChange={(event) => setSyncStockFromFile(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Actualizar stock desde `Total STOCK`
            </label>

            <Button
              onClick={handleImport}
              disabled={isImporting || preparedUpdates.length === 0}
              className="h-9 border-0 bg-emerald-600 text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700"
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {progress.current}/{progress.total}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Actualizar precios
                </>
              )}
            </Button>
          </div>
        </div>

        {preparedUpdates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              Listos para actualizar: {stats.ready}
            </Badge>
            <Badge variant="outline" className="gap-1 text-blue-700 border-blue-200">
              Sin cambios: {stats.unchanged}
            </Badge>
            {stats.invalid > 0 && (
              <Badge variant="outline" className="gap-1 border-rose-200 text-rose-600">
                <AlertTriangle className="h-3 w-3" />
                Con errores: {stats.invalid}
              </Badge>
            )}
            <Badge variant="outline">Productos en inventario: {catalogProducts.length}</Badge>
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2">
        <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Preview ({Math.min(preparedUpdates.length, 12)} de {preparedUpdates.length})
          </h2>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2">
              {preparedUpdates.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Carga el archivo para ver que cambios se aplicaran.
                </p>
              ) : (
                preparedUpdates.slice(0, 12).map((row) => (
                  <div
                    key={`${row.codigo}-${row.row}`}
                    className={`space-y-1 rounded-md border p-2 text-xs ${
                      row.blockingErrors.length > 0
                        ? "border-rose-200 bg-rose-50"
                        : row.willChange
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-blue-200 bg-blue-50"
                    }`}
                  >
                    <p className="font-medium text-slate-900">
                      {row.product?.name || row.name || "(sin nombre)"}
                    </p>
                    <p className="text-slate-600">
                      Codigo: <span className="font-mono">{row.codigo}</span>
                      {row.product && (
                        <>
                          {" "}
                          · Match: {row.matchedBy === "sku" ? "SKU" : "Barcode"}
                        </>
                      )}
                    </p>
                    <p className="text-slate-600">{formatPreviewPrices(row)}</p>
                    <p className="text-slate-600">
                      Stock archivo: {row.stock} · Socia archivo: {row.owner || "-"}
                    </p>
                    {row.blockingErrors.length > 0 ? (
                      <p className="font-medium text-rose-600">
                        {row.blockingErrors.join(", ")}
                      </p>
                    ) : row.willChange ? (
                      <p className="font-medium text-emerald-600">
                        Listo para actualizar
                      </p>
                    ) : (
                      <p className="font-medium text-blue-700">
                        Ya coincide con el inventario actual
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Resultado de actualizacion
          </h2>
          <ScrollArea className="min-h-0 flex-1">
            {!summary ? (
              <p className="text-xs text-slate-500">
                Aun no se ha ejecutado una actualizacion de precios.
              </p>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-center">
                    <p className="text-lg font-bold text-emerald-700">
                      {summary.updated}
                    </p>
                    <p className="text-emerald-600">Actualizados</p>
                  </div>
                  <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-center">
                    <p className="text-lg font-bold text-blue-700">
                      {summary.unchanged}
                    </p>
                    <p className="text-blue-600">Sin cambios</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-center">
                    <p className="text-lg font-bold text-slate-700">
                      {summary.invalid}
                    </p>
                    <p className="text-slate-600">Invalidos</p>
                  </div>
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-center">
                    <p className="text-lg font-bold text-rose-700">
                      {summary.failed}
                    </p>
                    <p className="text-rose-600">Fallidos</p>
                  </div>
                </div>

                {summary.errors.length > 0 && (
                  <div className="space-y-1 pt-2">
                    <p className="font-medium text-slate-900">Errores:</p>
                    {summary.errors.map((error) => (
                      <p key={error} className="text-rose-600">
                        {error}
                      </p>
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
