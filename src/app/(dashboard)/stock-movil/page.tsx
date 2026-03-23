"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Clock3,
  Copy,
  QrCode,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getErrorMessage } from "@/lib/error-utils";
import { formatEcuadorDateTime, formatEcuadorTime } from "@/lib/timezone-ecuador";
import {
  issueMobileAccessCode,
  listActiveMobileSessions,
  listRecentStockAdjustments,
  revokeMobileSession,
  type ActiveMobileSessionView,
  type IssuedMobileAccessCode,
  type RecentStockAdjustmentView,
} from "@/lib/stock-mobile";

const TTL_OPTIONS = [
  { value: "30", label: "30 minutos" },
  { value: "60", label: "1 hora" },
  { value: "240", label: "4 horas" },
];

function buildMobileAccessUrl(origin: string, token: string) {
  return `${origin}/movil/stock?token=${encodeURIComponent(token)}`;
}

function isLoopbackHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "tauri.localhost";
}

export default function StockMovilPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ttlMinutes, setTtlMinutes] = useState("60");
  const [mobileOrigin, setMobileOrigin] = useState("");
  const [issuedCode, setIssuedCode] = useState<IssuedMobileAccessCode | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ActiveMobileSessionView[]>([]);
  const [adjustments, setAdjustments] = useState<RecentStockAdjustmentView[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refreshLists = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [sessionRows, adjustmentRows] = await Promise.all([
        listActiveMobileSessions(20),
        listRecentStockAdjustments(12),
      ]);
      setSessions(sessionRows);
      setAdjustments(adjustmentRows);
    } catch (error) {
      const message = getErrorMessage(error, "No se pudo refrescar Stock movil.");
      toast.error(message);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setMobileOrigin(window.location.origin);

      if (isLoopbackHost(window.location.hostname)) {
        void fetch("/api/local-network-info")
          .then((response) => response.json())
          .then((payload: { lanIp?: string | null }) => {
            const lanIp = payload?.lanIp?.trim();
            if (!lanIp) return;
            const protocol = window.location.protocol;
            const port = window.location.port ? `:${window.location.port}` : "";
            setMobileOrigin(`${protocol}//${lanIp}${port}`);
          })
          .catch(() => {
            // Fallback silencioso al origin actual
          });
      }
    }
    void refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !issuedCode || !mobileOrigin) {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;
    const generateQr = async () => {
      try {
        const bwipModule = await import("bwip-js");
        const bwipjs = bwipModule.default;
        const link = buildMobileAccessUrl(mobileOrigin, issuedCode.qrToken);
        bwipjs.toCanvas(canvas, {
          bcid: "qrcode",
          text: link,
          scale: 4,
          includetext: false,
        });
        if (!cancelled) {
          setQrDataUrl(canvas.toDataURL("image/png"));
        }
      } catch (error) {
        console.error("[StockMovilPage] QR generation error:", error);
        if (!cancelled) {
          setQrDataUrl(null);
        }
      }
    };

    void generateQr();

    return () => {
      cancelled = true;
    };
  }, [issuedCode, mobileOrigin]);

  const handleIssueCode = async () => {
    setIsGenerating(true);
    try {
      const issued = await issueMobileAccessCode(Number(ttlMinutes));
      setIssuedCode(issued);
      toast.success(`Codigo ${issued.code} generado.`);
      await refreshLists();
    } catch (error) {
      const message = getErrorMessage(error, "No se pudo generar el codigo.");
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!issuedCode || !mobileOrigin) return;
    try {
      const link = buildMobileAccessUrl(mobileOrigin, issuedCode.qrToken);
      await navigator.clipboard.writeText(link);
      toast.success("Link copiado.");
    } catch (error) {
      console.error("[StockMovilPage] clipboard error:", error);
      toast.error("No se pudo copiar el link.");
    }
  };

  const handleRevoke = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      const ok = await revokeMobileSession(sessionId);
      if (!ok) {
        toast.error("No se pudo revocar la sesion.");
        return;
      }
      toast.success("Sesion revocada.");
      await refreshLists();
    } catch (error) {
      const message = getErrorMessage(error, "No se pudo revocar la sesion.");
      toast.error(message);
    } finally {
      setRevokingId(null);
    }
  };

  const issuedLink =
    issuedCode && mobileOrigin ? buildMobileAccessUrl(mobileOrigin, issuedCode.qrToken) : "";

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Smartphone className="h-6 w-6 text-indigo-600" />
          Stock Movil
        </h1>
        <p className="text-sm text-slate-500">
          Emite acceso temporal por QR/codigo y supervisa ajustes de conteo.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <QrCode className="h-5 w-5 text-indigo-600" />
              Acceso QR Express
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={ttlMinutes}
                onValueChange={(value) => setTtlMinutes(value ?? "60")}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TTL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleIssueCode}
                disabled={isGenerating}
                className="bg-indigo-600 text-white hover:bg-indigo-700"
              >
                {isGenerating ? (
                  <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Generar acceso
              </Button>
            </div>

            <canvas ref={canvasRef} className="hidden" />

            {issuedCode ? (
              <div className="grid gap-4 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 lg:grid-cols-[210px_1fr]">
                <div className="flex justify-center">
                  {qrDataUrl ? (
                    <Image
                      src={qrDataUrl}
                      alt="QR de acceso movil"
                      className="rounded-lg border border-indigo-100 bg-white p-2"
                      width={200}
                      height={200}
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-[200px] w-[200px] items-center justify-center rounded-lg border border-dashed border-indigo-200 bg-white text-xs text-slate-500">
                      QR no disponible
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border border-indigo-200 bg-white p-3">
                    <p className="text-xs uppercase tracking-wide text-indigo-700">
                      Codigo manual (6 digitos)
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold text-slate-900">{issuedCode.code}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Expira: {formatEcuadorDateTime(issuedCode.expiresAt)}
                    </p>
                  </div>

                  <div className="rounded-lg border border-indigo-200 bg-white p-3">
                    <p className="text-xs uppercase tracking-wide text-indigo-700">Link movil</p>
                    <p className="mt-1 break-all font-mono text-xs text-slate-700">{issuedLink}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopy}
                      className="mt-3 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copiar link
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                Genera un codigo para habilitar acceso movil temporal.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-emerald-600" />
              Sesiones activas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Activas</p>
                <p className="text-xl font-semibold text-slate-900">{sessions.length}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void refreshLists()} disabled={isRefreshing}>
                <RefreshCcw className={`mr-2 h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                Refrescar
              </Button>
            </div>

            <div className="max-h-[380px] space-y-2 overflow-auto pr-1">
              {sessions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                  No hay sesiones moviles activas.
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">
                        {session.operatorName?.trim() || "Operador"}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 border-rose-200 px-2.5 text-xs text-rose-700 hover:bg-rose-50"
                        onClick={() => void handleRevoke(session.id)}
                        disabled={revokingId === session.id}
                      >
                        Revocar
                      </Button>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-600">{session.accessCode}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" />
                        Expira {formatEcuadorTime(session.expiresAt, { hour12: true })}
                      </span>
                      <span>Ultimo latido {formatEcuadorTime(session.lastSeenAt, { hour12: true })}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Ajustes recientes de stock
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Hora</th>
                  <th className="px-2 py-2">Producto</th>
                  <th className="px-2 py-2">Delta</th>
                  <th className="px-2 py-2">Antes</th>
                  <th className="px-2 py-2">Conteo</th>
                  <th className="px-2 py-2">Origen</th>
                  <th className="px-2 py-2">Operador</th>
                  <th className="px-2 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-2 py-6 text-center text-slate-500">
                      Sin ajustes registrados.
                    </td>
                  </tr>
                ) : (
                  adjustments.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="px-2 py-2 text-xs text-slate-600">
                        {formatEcuadorDateTime(item.createdAt)}
                      </td>
                      <td className="px-2 py-2">
                        <p className="font-medium text-slate-900">{item.productName}</p>
                        <p className="font-mono text-xs text-slate-500">{item.productBarcode}</p>
                      </td>
                      <td
                        className={`px-2 py-2 font-semibold ${
                          item.delta > 0
                            ? "text-emerald-700"
                            : item.delta < 0
                            ? "text-rose-700"
                            : "text-slate-600"
                        }`}
                      >
                        {item.delta > 0 ? `+${item.delta}` : item.delta}
                      </td>
                      <td className="px-2 py-2 text-slate-700">{item.stockBefore}</td>
                      <td className="px-2 py-2 text-slate-700">{item.stockCounted}</td>
                      <td className="px-2 py-2 text-slate-600">{item.source}</td>
                      <td className="px-2 py-2 text-slate-600">{item.operatorName || "-"}</td>
                      <td className="px-2 py-2 text-slate-600">{item.reviewStatus}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
