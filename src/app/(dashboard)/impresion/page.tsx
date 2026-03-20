"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  Printer,
  RefreshCcw,
  Save,
  TestTube2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getSavedTicketPrinterName,
  listLocalPrinters,
  setSavedTicketPrinterName,
  type LocalPrinterInfo,
} from "@/lib/local/printers";
import { isTauriRuntime } from "@/lib/tauri-runtime";
import { formatEcuadorDate, formatEcuadorTime } from "@/lib/timezone-ecuador";

const WINDOWS_DEFAULT_VALUE = "__WINDOWS_DEFAULT__";

function buildPrinterTestTicket(printerName: string | null) {
  const now = new Date();
  const printerLabel = printerName?.trim() || "Predeterminada de Windows";

  return [
    "POS Tienda de Ropa",
    "prueba de impresion",
    "",
    `Fecha: ${formatEcuadorDate(now)} ${formatEcuadorTime(now)}`,
    `Impresora: ${printerLabel}`,
    "--------------------------------",
    "Si este ticket sale bien,",
    "esta impresora queda lista",
    "para registrar ventas.",
    "--------------------------------",
    "fin de prueba",
  ].join("\n");
}

export default function ImpresionPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [printers, setPrinters] = useState<LocalPrinterInfo[]>([]);
  const [savedPrinterName, setSavedPrinterNameState] = useState<string | null>(null);
  const [selectedPrinterValue, setSelectedPrinterValue] = useState(WINDOWS_DEFAULT_VALUE);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPrinters = useCallback(async () => {
    if (!isTauriRuntime()) {
      setLoadError("La seleccion de impresora solo funciona dentro de la app de escritorio.");
      setPrinters([]);
      setSavedPrinterNameState(null);
      setSelectedPrinterValue(WINDOWS_DEFAULT_VALUE);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      const [availablePrinters, savedPrinter] = await Promise.all([
        listLocalPrinters(),
        getSavedTicketPrinterName(),
      ]);

      setPrinters(availablePrinters);
      setSavedPrinterNameState(savedPrinter);
      setSelectedPrinterValue(savedPrinter || WINDOWS_DEFAULT_VALUE);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "No se pudo cargar la lista de impresoras.";

      setLoadError(message);
      setPrinters([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPrinters();
  }, [loadPrinters]);

  const printerOptions = useMemo(() => {
    if (
      savedPrinterName &&
      !printers.some((printer) => printer.name === savedPrinterName)
    ) {
      return [
        {
          name: savedPrinterName,
          isDefault: false,
          isOffline: true,
          printerStatus: null,
          isVirtual: false,
        },
        ...printers,
      ];
    }

    return printers;
  }, [printers, savedPrinterName]);

  const selectedPrinterName =
    selectedPrinterValue === WINDOWS_DEFAULT_VALUE ? null : selectedPrinterValue;

  const selectedPrinter = useMemo(
    () => printerOptions.find((printer) => printer.name === selectedPrinterName) ?? null,
    [printerOptions, selectedPrinterName]
  );

  const savedPrinterLabel = savedPrinterName?.trim()
    ? savedPrinterName
    : "Predeterminada de Windows";

  const hasUnsavedChanges =
    (savedPrinterName || WINDOWS_DEFAULT_VALUE) !== selectedPrinterValue;

  const handleSave = async () => {
    setIsSaving(true);

    try {
      await setSavedTicketPrinterName(selectedPrinterName);
      setSavedPrinterNameState(selectedPrinterName);
      toast.success("Impresora guardada", {
        description: selectedPrinterName || "Se usara la predeterminada de Windows.",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "No se pudo guardar la impresora.";

      toast.error("No se pudo guardar la impresora", {
        description: message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setIsTesting(true);

    try {
      await invoke("print_text_ticket_silent", {
        ticketText: buildPrinterTestTicket(selectedPrinterName),
        printerName: selectedPrinterName,
      });

      toast.success("Prueba enviada", {
        description: selectedPrinterName || "Se uso la impresora predeterminada de Windows.",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "No se pudo imprimir la prueba.";

      toast.error("No se pudo imprimir la prueba", {
        description: message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Printer className="h-6 w-6 text-indigo-600" />
          Impresion
        </h1>
        <p className="text-sm text-slate-500">
          Elige la impresora de tickets que usara el programa al registrar ventas.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Printer className="h-5 w-5 text-sky-600" />
              Selector de impresora
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Guardada</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{savedPrinterLabel}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Impresoras</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{printerOptions.length}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Runtime</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {isTauriRuntime() ? "Desktop Tauri" : "Web"}
                </p>
              </div>
            </div>

            {loadError && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm">{loadError}</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Impresora para tickets</label>
              <Select
                value={selectedPrinterValue}
                onValueChange={(value) =>
                  setSelectedPrinterValue(value ?? WINDOWS_DEFAULT_VALUE)
                }
                disabled={isLoading || !!loadError}
              >
                <SelectTrigger className="h-11 w-full rounded-xl border-slate-200 bg-white px-3">
                  <SelectValue placeholder="Selecciona una impresora" />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value={WINDOWS_DEFAULT_VALUE}>
                    Predeterminada de Windows
                  </SelectItem>
                  {printerOptions.map((printer) => (
                    <SelectItem key={printer.name} value={printer.name}>
                      {printer.name}
                      {printer.isDefault ? " (predeterminada)" : ""}
                      {printer.isVirtual ? " [virtual]" : ""}
                      {printer.isOffline ? " [offline]" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Si eliges una impresora fija, las ventas y reimpresiones usaran esa en vez de la
                predeterminada de Windows.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void loadPrinters()} variant="outline" disabled={isLoading}>
                <RefreshCcw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                Recargar lista
              </Button>
              <Button
                onClick={() => void handleSave()}
                disabled={!!loadError || isSaving || isLoading || !hasUnsavedChanges}
                className="bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <Save className="mr-2 h-4 w-4" />
                Guardar impresora
              </Button>
              <Button
                onClick={() => void handleTestPrint()}
                variant="outline"
                disabled={!!loadError || isTesting || isLoading}
              >
                <TestTube2 className="mr-2 h-4 w-4" />
                Probar impresion
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Estado de la seleccion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">Impresora elegida ahora</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {selectedPrinterName || "Predeterminada de Windows"}
                  </p>
                </div>
                {selectedPrinter?.isDefault && <Badge variant="outline">Predeterminada</Badge>}
              </div>
            </div>

            {selectedPrinter?.isOffline && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <p className="font-medium">La impresora aparece offline</p>
                <p className="mt-1 text-sm">
                  Windows reporta esta impresora fuera de linea. Conviene revisarla antes de cobrar.
                </p>
              </div>
            )}

            {selectedPrinter?.isVirtual && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <p className="font-medium">Impresora virtual detectada</p>
                <p className="mt-1 text-sm">
                  Esa impresora parece PDF/XPS/Fax. Para tickets del local deberias usar la Epson
                  TM-U220.
                </p>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-medium text-slate-900">Recomendacion</p>
              <p className="mt-1">
                Si la Epson esta conectada por USB, guárdala aqui una vez y desde ese momento el
                sistema intentará imprimir directo siempre en esa misma impresora.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
