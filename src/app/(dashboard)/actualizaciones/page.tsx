"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Download,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { relaunch } from "@tauri-apps/plugin-process";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_VERSION } from "@/lib/constants";
import { checkForAppUpdate, type UpdateStatus } from "@/lib/update/app-updater";

type UpdateState = UpdateStatus & {
  checking: boolean;
  installing: boolean;
  progress: number;
};

const INITIAL_STATE: UpdateState = {
  available: false,
  version: null,
  notes: null,
  date: null,
  error: null,
  checking: false,
  installing: false,
  progress: 0,
};

export default function ActualizacionesPage() {
  const [state, setState] = useState<UpdateState>(INITIAL_STATE);

  const runCheck = async () => {
    setState((current) => ({
      ...current,
      checking: true,
      error: null,
    }));

    const result = await checkForAppUpdate();
    setState((current) => ({
      ...current,
      ...result.status,
      checking: false,
      progress: 0,
      installing: false,
    }));
  };

  const installUpdate = async () => {
    if (!state.available) return;

    setState((current) => ({
      ...current,
      installing: true,
      progress: 0,
      error: null,
    }));

    try {
      const { update } = await checkForAppUpdate();
      if (!update) {
        await runCheck();
        return;
      }

      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            contentLength = Number(event.data.contentLength ?? 0);
            setState((current) => ({
              ...current,
              progress: 0,
            }));
            break;
          case "Progress":
            downloaded += Number(event.data.chunkLength ?? 0);
            setState((current) => ({
              ...current,
              progress: contentLength
                ? Math.min(100, Math.round((downloaded / contentLength) * 100))
                : current.progress,
            }));
            break;
          case "Finished":
            setState((current) => ({
              ...current,
              progress: 100,
            }));
            break;
        }
      });

      setState((current) => ({
        ...current,
        installing: false,
        available: false,
      }));

      try {
        await relaunch();
      } catch (error) {
        console.warn("[ActualizacionesPage] no se pudo relanzar la app tras actualizar:", error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo instalar la actualizacion";
      setState((current) => ({
        ...current,
        installing: false,
        error: message,
      }));
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runCheck();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <CloudDownload className="h-6 w-6 text-indigo-600" />
          Actualizaciones
        </h1>
        <p className="text-sm text-slate-500">
          Actualiza esta instalacion sin bajar un instalador manual.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Estado de version
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Version local</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{APP_VERSION}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Estado</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {state.checking
                    ? "Buscando..."
                    : state.installing
                    ? "Instalando..."
                    : state.available
                    ? "Hay nueva version"
                    : state.error
                    ? "Error"
                    : "Actualizado"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Progreso</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{state.progress}%</p>
              </div>
            </div>

            {state.error && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm">{state.error}</p>
              </div>
            )}

            {state.available && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                <p className="text-sm font-medium text-indigo-900">
                  Nueva version disponible: {state.version}
                </p>
                {state.date && (
                  <p className="mt-1 text-xs text-indigo-700">Publicada: {state.date}</p>
                )}
                {state.notes && (
                  <p className="mt-2 whitespace-pre-line text-sm text-indigo-900/90">
                    {state.notes}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button onClick={runCheck} variant="outline" disabled={state.checking || state.installing}>
                <RefreshCcw className={`mr-2 h-4 w-4 ${state.checking ? "animate-spin" : ""}`} />
                Buscar actualizacion
              </Button>
              <Button
                onClick={installUpdate}
                disabled={!state.available || state.installing}
                className="bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <Download className="mr-2 h-4 w-4" />
                Actualizar ahora
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="h-5 w-5 text-sky-600" />
              Flujo de publicacion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-medium text-slate-900">1. Compilas una version nueva</p>
              <p className="mt-1">Se genera el instalador firmado y el archivo `latest.json`.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-medium text-slate-900">2. Subes a GitHub Releases</p>
              <p className="mt-1">La app instalada usa ese release como origen de actualizaciones.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-medium text-slate-900">3. El usuario actualiza desde aqui</p>
              <p className="mt-1">No necesita bajar instaladores nuevos cada vez.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="font-medium text-slate-900">4. Firma obligatoria</p>
              <p className="mt-1">Tauri no permite updater sin firma de release.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
