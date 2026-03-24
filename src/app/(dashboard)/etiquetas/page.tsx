"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ListChecks,
  Minus,
  PackageSearch,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getPartnerVisual } from "@/components/inventory/inventory-ui";
import { getCatalogPartners, searchCatalogProductsByIntent } from "@/lib/local/catalog";
import { printProductLabels } from "@/lib/print-label";
import { formatPriceValue } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import type { Partner, ProductWithOwner } from "@/types/database";

const PAGE_SIZE = 80;

interface LabelQueueItem {
  product: ProductWithOwner;
  copies: number;
}

function clampCopies(value: number) {
  return Math.min(Math.max(Math.trunc(value) || 1, 1), 200);
}

function getProductCode(product: ProductWithOwner) {
  return product.sku || product.barcode || "-";
}

export default function EtiquetasPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<ProductWithOwner[]>([]);
  const [queueItems, setQueueItems] = useState<LabelQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterOwner, setFilterOwner] = useState<string | null>(null);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [defaultCopiesInput, setDefaultCopiesInput] = useState("1");

  const defaultCopies = clampCopies(Number.parseInt(defaultCopiesInput, 10) || 1);
  const totalCopies = useMemo(
    () => queueItems.reduce((sum, item) => sum + item.copies, 0),
    [queueItems]
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    let isCancelled = false;

    const fetchPartners = async () => {
      try {
        const data = await getCatalogPartners();
        if (!isCancelled) {
          setPartners(data);
        }
      } catch (error) {
        console.error("[EtiquetasPage] fetchPartners error:", error);
      }
    };

    void fetchPartners();

    return () => {
      isCancelled = true;
    };
  }, []);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);

    try {
      const catalogProducts = await searchCatalogProductsByIntent({
        search: debouncedSearch,
        ownerId: filterOwner,
        stockFilter: "all",
        limit: PAGE_SIZE,
        offset: 0,
      });

      setProducts(catalogProducts);
      setSelectedCatalogId((current) => {
        if (current && catalogProducts.some((product) => product.id === current)) {
          return current;
        }

        return catalogProducts[0]?.id ?? null;
      });
    } catch (error) {
      console.error("[EtiquetasPage] fetchProducts error:", error);
      toast.error("No se pudo cargar el catalogo para etiquetas");
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, filterOwner]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  const handleAddProduct = (product: ProductWithOwner) => {
    setSelectedCatalogId(product.id);
    setQueueItems((current) => {
      const existingIndex = current.findIndex((item) => item.product.id === product.id);
      if (existingIndex >= 0) {
        return current.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                copies: clampCopies(item.copies + defaultCopies),
              }
            : item
        );
      }

      return [...current, { product, copies: defaultCopies }];
    });
  };

  const updateCopies = (productId: string, nextValue: number) => {
    setQueueItems((current) =>
      current.map((item) =>
        item.product.id === productId
          ? {
              ...item,
              copies: clampCopies(nextValue),
            }
          : item
      )
    );
  };

  const removeQueueItem = (productId: string) => {
    setQueueItems((current) => current.filter((item) => item.product.id !== productId));
  };

  const clearQueue = () => {
    setQueueItems([]);
  };

  const handleRefresh = async () => {
    await fetchProducts();
  };

  const handlePrintQueue = async () => {
    if (queueItems.length === 0) return;

    setIsPrinting(true);
    try {
      for (const item of queueItems) {
        await printProductLabels({
          product: item.product,
          priceTier: "normal",
          copies: item.copies,
        });
      }

      toast.success("Etiquetas enviadas a impresion", {
        description: `${queueItems.length} producto(s) y ${totalCopies} copia(s) en lote.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudieron imprimir las etiquetas";
      toast.error("Error al imprimir etiquetas", {
        description: message,
      });
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Tags className="h-5 w-5 text-slate-700" />
            Imprimir etiquetas
          </h1>
          <p className="text-sm text-muted-foreground">
            Agrega varios productos al listado y manda todas las etiquetas juntas.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/impresion"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "border-slate-200 bg-white shadow-sm"
            )}
          >
            Configuracion de impresion
          </Link>
          <Button
            onClick={() => void handlePrintQueue()}
            disabled={queueItems.length === 0 || isPrinting}
            className="bg-slate-900 text-white hover:bg-slate-800"
          >
            <Printer className="mr-2 h-4 w-4" />
            {isPrinting ? "Imprimiendo..." : "Imprimir etiquetas"}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[0.94fr_1.06fr]">
        <Card className="flex min-h-0 flex-col border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ListChecks className="h-5 w-5 text-indigo-600" />
                Listado a imprimir
              </CardTitle>
              <span className="text-xs font-medium text-slate-500">
                {queueItems.length} producto{queueItems.length === 1 ? "" : "s"} | {totalCopies} copia
                {totalCopies === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Flujo
                </p>
                <p className="mt-0.5 text-[13px] leading-5 text-slate-600">
                  Haz clic en un producto del catalogo para agregarlo al listado.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Copias por defecto
                </p>
                <Input
                  value={defaultCopiesInput}
                  onChange={(event) =>
                    setDefaultCopiesInput(event.target.value.replace(/[^\d]/g, "").slice(0, 3))
                  }
                  onBlur={() => setDefaultCopiesInput(String(defaultCopies))}
                  inputMode="numeric"
                  className="mt-0.5 h-7 border-0 bg-transparent px-0 font-mono text-base font-semibold shadow-none focus-visible:ring-0"
                />
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-full min-h-[74px] border-slate-200 bg-white px-4 text-slate-600 hover:bg-slate-50"
                onClick={clearQueue}
                disabled={queueItems.length === 0 || isPrinting}
              >
                Limpiar
              </Button>
            </div>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 p-0">
            {queueItems.length === 0 ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-center text-slate-400">
                <ListChecks className="h-12 w-12 text-slate-300" />
                <div>
                  <p className="text-base font-medium text-slate-600">No hay productos en el listado</p>
                  <p className="mt-1 text-sm">Selecciona productos desde el catalogo para armar el lote.</p>
                </div>
              </div>
            ) : (
              <div className="min-h-0 h-full overflow-y-auto">
                <div className="divide-y divide-slate-100">
                  {queueItems.map((item, index) => {
                    const visual = getPartnerVisual(item.product.owner.name);

                    return (
                      <div
                        key={item.product.id}
                        className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50/70"
                      >
                        <div
                          className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r-md"
                          style={{ backgroundColor: visual.accent }}
                        />

                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-mono text-xs font-semibold text-slate-600">
                          {index + 1}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-800">
                              {item.product.name}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] font-medium text-slate-500">
                              {getProductCode(item.product)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                            <span className="flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: visual.accent }}
                              />
                              {item.product.owner.display_name}
                            </span>
                            <span className="font-mono font-semibold text-slate-700">
                              {formatPriceValue(item.product.sale_price)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex items-center rounded-lg border border-slate-200 bg-white shadow-sm">
                            <button
                              type="button"
                              className="flex h-8 w-8 items-center justify-center text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
                              onClick={() => updateCopies(item.product.id, item.copies - 1)}
                              aria-label={`Reducir copias de ${item.product.name}`}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <Input
                              value={String(item.copies)}
                              onChange={(event) =>
                                updateCopies(
                                  item.product.id,
                                  Number.parseInt(
                                    event.target.value.replace(/[^\d]/g, "").slice(0, 3),
                                    10
                                  ) || 1
                                )
                              }
                              onBlur={() => updateCopies(item.product.id, item.copies)}
                              inputMode="numeric"
                              className="h-8 w-14 border-0 bg-transparent px-0 text-center font-mono text-sm font-semibold shadow-none focus-visible:ring-0"
                            />
                            <button
                              type="button"
                              className="flex h-8 w-8 items-center justify-center text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
                              onClick={() => updateCopies(item.product.id, item.copies + 1)}
                              aria-label={`Aumentar copias de ${item.product.name}`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            onClick={() => removeQueueItem(item.product.id)}
                            aria-label={`Quitar ${item.product.name} del listado`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-sm text-slate-500">
              <span className="font-semibold text-slate-700">{queueItems.length}</span> producto
              {queueItems.length === 1 ? "" : "s"} seleccionado
              {queueItems.length === 1 ? "" : "s"} para imprimir.
            </div>
            <Button
              onClick={() => void handlePrintQueue()}
              disabled={queueItems.length === 0 || isPrinting}
              className="bg-indigo-600 text-white hover:bg-indigo-700"
            >
              <Printer className="mr-2 h-4 w-4" />
              {isPrinting ? "Imprimiendo..." : "Imprimir lote"}
            </Button>
          </div>
        </Card>

        <Card className="flex min-h-0 flex-col border-slate-200 shadow-sm">
          <CardHeader className="space-y-3 border-b border-slate-100">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <PackageSearch className="h-5 w-5 text-sky-600" />
                Catalogo de productos
              </CardTitle>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {products.length} resultado{products.length === 1 ? "" : "s"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                  onClick={() => void handleRefresh()}
                  aria-label="Refrescar catalogo"
                >
                  <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                </Button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar por producto, codigo o barras..."
                className="pl-9"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setFilterOwner(null)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                  !filterOwner
                    ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                )}
              >
                Todas
              </button>
              {partners.map((partner) => {
                const visual = getPartnerVisual(partner.name);
                const isActive = filterOwner === partner.id;

                return (
                  <button
                    key={partner.id}
                    onClick={() => setFilterOwner(isActive ? null : partner.id)}
                    className={cn(
                      "flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-all",
                      isActive
                        ? "shadow-sm"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    )}
                    style={
                      isActive
                        ? {
                            borderColor: visual.softBorder,
                            backgroundColor: visual.softBackground,
                            color: visual.softText,
                          }
                        : undefined
                    }
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: visual.accent }}
                    />
                    {partner.display_name}
                  </button>
                );
              })}

              <div className="ml-auto text-xs text-slate-400">
                Clic en una fila para agregarla al listado
              </div>
            </div>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 p-0">
            {isLoading ? (
              <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-slate-500">
                Cargando productos...
              </div>
            ) : products.length === 0 ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-center text-slate-400">
                <PackageSearch className="h-12 w-12 text-slate-300" />
                <div>
                  <p className="text-base font-medium text-slate-600">No hay productos para mostrar</p>
                  <p className="mt-1 text-sm">Prueba con otra busqueda o cambia la socia filtrada.</p>
                </div>
              </div>
            ) : (
              <div className="min-h-0 h-full overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 shadow-sm">
                    <tr>
                      <th className="w-28 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Codigo
                      </th>
                      <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Producto
                      </th>
                      <th className="w-28 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Socia
                      </th>
                      <th className="w-24 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        PVP
                      </th>
                      <th className="w-16 px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Agregar
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {products.map((product) => {
                      const visual = getPartnerVisual(product.owner.name);
                      const isActive = selectedCatalogId === product.id;

                      return (
                        <tr
                          key={product.id}
                          onClick={() => handleAddProduct(product)}
                          className={cn(
                            "cursor-pointer border-b border-slate-100/70 transition-colors",
                            isActive ? "bg-indigo-50/60" : "hover:bg-slate-50"
                          )}
                        >
                          <td className="relative px-4 py-2">
                            <div
                              className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r-md"
                              style={{ backgroundColor: visual.accent }}
                            />
                            <span className="ml-1 block font-mono text-[11px] font-semibold uppercase text-slate-800">
                              {getProductCode(product)}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <span className="block truncate text-[12px] font-medium text-slate-700">
                              {product.name}
                            </span>
                            <span className="block font-mono text-[10px] text-slate-400">
                              {product.barcode}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: visual.accent }}
                              />
                              {product.owner.display_name}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-[12px] font-bold text-slate-900">
                            {formatPriceValue(product.sale_price)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleAddProduct(product);
                              }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
                              aria-label={`Agregar ${product.name} al listado`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
