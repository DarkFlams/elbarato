"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  LogOut,
  RefreshCcw,
  Search,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getErrorMessage } from "@/lib/error-utils";
import {
  applyStockCountAdjustment,
  clearStoredStockMobileSession,
  consumeMobileAccessCode,
  findStockMobileProductByCode,
  isStockMobileSessionExpired,
  loadStoredStockMobileSession,
  saveStoredStockMobileSession,
  touchMobileSession,
  type MobileSessionPayload,
  type StockMobileProduct,
} from "@/lib/stock-mobile";
import { formatEcuadorDateTime } from "@/lib/timezone-ecuador";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function StockMovilPageInner() {
  const searchParams = useSearchParams();
  const [session, setSession] = useState<MobileSessionPayload | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [productCode, setProductCode] = useState("");
  const [searchingProduct, setSearchingProduct] = useState(false);
  const [product, setProduct] = useState<StockMobileProduct | null>(null);
  const [countedStockInput, setCountedStockInput] = useState("");
  const [submittingAdjustment, setSubmittingAdjustment] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [heartbeatLoading, setHeartbeatLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [photoScanning, setPhotoScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerFrameRef = useRef<number | null>(null);
  const scannerDetectorRef = useRef<BarcodeDetectorLike | null>(null);

  const tokenFromUrl = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const logoutSession = useCallback(() => {
    clearStoredStockMobileSession();
    setSession(null);
    setProduct(null);
    setCountedStockInput("");
  }, []);

  const stopCameraScanner = useCallback(() => {
    if (scannerFrameRef.current !== null) {
      window.cancelAnimationFrame(scannerFrameRef.current);
      scannerFrameRef.current = null;
    }

    if (scannerStreamRef.current) {
      scannerStreamRef.current.getTracks().forEach((track) => track.stop());
      scannerStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    scannerDetectorRef.current = null;
    setScannerOpen(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(window.navigator.onLine);

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopCameraScanner();
    };
  }, [stopCameraScanner]);

  useEffect(() => {
    const stored = loadStoredStockMobileSession();
    if (!stored) return;

    if (isStockMobileSessionExpired(stored.expiresAt)) {
      clearStoredStockMobileSession();
      return;
    }

    setSession(stored);
  }, []);

  useEffect(() => {
    if (!tokenFromUrl || session) return;
    setCodeInput(tokenFromUrl);
  }, [tokenFromUrl, session]);

  useEffect(() => {
    if (!session) return;

    const heartbeatId = window.setInterval(() => {
      if (!isOnline) return;

      void touchMobileSession(session.sessionId)
        .then((alive) => {
          if (!alive) {
            toast.error("La sesion movil expiro o fue revocada.");
            logoutSession();
          }
        })
        .catch((error) => {
          console.error("[StockMovilPage] heartbeat error:", error);
        });
    }, 60000);

    const expiryGuardId = window.setInterval(() => {
      if (isStockMobileSessionExpired(session.expiresAt)) {
        toast.error("La sesion movil expiro.");
        logoutSession();
      }
    }, 15000);

    return () => {
      window.clearInterval(heartbeatId);
      window.clearInterval(expiryGuardId);
    };
  }, [isOnline, logoutSession, session]);

  useEffect(() => {
    if (!session && scannerOpen) {
      stopCameraScanner();
    }
  }, [scannerOpen, session, stopCameraScanner]);

  const handleConsumeCode = async () => {
    if (!codeInput.trim()) {
      toast.error("Ingresa el codigo o token.");
      return;
    }

    if (!isOnline) {
      toast.error("Sin internet. Reintenta cuando vuelva la red.");
      return;
    }

    setLoginLoading(true);
    try {
      const nextSession = await consumeMobileAccessCode(codeInput.trim(), operatorName.trim());
      setSession(nextSession);
      saveStoredStockMobileSession(nextSession);
      toast.success("Acceso movil habilitado.");
      setCodeInput("");
    } catch (error) {
      const message = getErrorMessage(error, "No se pudo abrir la sesion movil.");
      toast.error(message);
    } finally {
      setLoginLoading(false);
    }
  };

  const searchProductByCode = useCallback(
    async (rawCode: string) => {
      if (!session?.sessionId) {
        toast.error("Sesion movil no valida.");
        return;
      }

      const normalizedCode = rawCode.trim();
      if (!normalizedCode) {
        toast.error("Escanea o escribe barcode, SKU o nombre.");
        return;
      }

      if (!isOnline) {
        toast.error("Sin internet. Reintenta cuando vuelva la red.");
        return;
      }

      setSearchingProduct(true);
      try {
        const found = await findStockMobileProductByCode(normalizedCode, session.sessionId);
        if (!found) {
          toast.error("Producto no encontrado con ese barcode, SKU o nombre.");
          setProduct(null);
          return;
        }
        setProductCode(normalizedCode);
        setProduct(found);
        setCountedStockInput(String(found.stock));
      } catch (error) {
        const message = getErrorMessage(error, "No se pudo buscar el producto.");
        toast.error(message);
      } finally {
        setSearchingProduct(false);
      }
    },
    [isOnline, session]
  );

  const handleSearchProduct = async () => {
    if (!productCode.trim()) {
      toast.error("Escanea o escribe barcode, SKU o nombre.");
      return;
    }

    await searchProductByCode(productCode);
  };

  const readLabelCandidatesWithOcr = useCallback(async (file: File): Promise<string[]> => {
    const { createWorker, PSM } = await import("tesseract.js");

    const normalizeCandidate = (value: string) =>
      value
        .toUpperCase()
        .replace(/[OI]/g, (char) => (char === "O" ? "0" : "1"))
        .replace(/[^A-Z0-9]/g, "")
        .trim();

    const collectCandidatesFromText = (rawText: string) => {
      const text = rawText.toUpperCase();
      const candidates: string[] = [];
      const seen = new Set<string>();

      const push = (value: string) => {
        const normalized = normalizeCandidate(value);
        if (!normalized || normalized.length < 4 || normalized.length > 24) return;
        if (seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
      };

      const labeledPatterns = [
        /BARRAS?\s*[:\-]?\s*([A-Z0-9\-]{3,})/g,
        /CODIGO\s*[:\-]?\s*([A-Z0-9\-]{3,})/g,
        /SKU\s*[:\-]?\s*([A-Z0-9\-]{3,})/g,
      ];

      for (const pattern of labeledPatterns) {
        for (const match of text.matchAll(pattern)) {
          push(match[1] || "");
        }
      }

      const generic = text.match(/[A-Z0-9]{4,24}/g) || [];
      for (const token of generic) {
        push(token);
      }

      return candidates.slice(0, 12);
    };

    const worker = await createWorker("eng", 1, {
      logger: () => {},
    });

    try {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:- ",
      });

      const { data } = await worker.recognize(file, { rotateAuto: true });
      return collectCandidatesFromText(data?.text || "");
    } finally {
      await worker.terminate();
    }
  }, []);

  const decodeBarcodeFromImageFile = useCallback(async (file: File): Promise<string> => {
    const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import("@zxing/library");

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.CODABAR,
      BarcodeFormat.ITF,
      BarcodeFormat.RSS_14,
      BarcodeFormat.QR_CODE,
    ]);

    const reader = new BrowserMultiFormatReader(hints, 500);
    const objectUrl = URL.createObjectURL(file);

    try {
      const loadImage = async (url: string) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      };

      const decodeImage = async (img: HTMLImageElement) => {
        const result = await reader.decodeFromImageElement(img);
        return result.getText().trim();
      };

      const sourceImage = await loadImage(objectUrl);

      try {
        const direct = await decodeImage(sourceImage);
        if (direct) return direct;
      } catch {
        // Continua con variantes procesadas.
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        throw new Error("No se pudo preparar el procesamiento de imagen.");
      }

      const variants: Array<{
        cropXRatio: number;
        cropWidthRatio: number;
        threshold: number | null;
      }> = [
        { cropXRatio: 0, cropWidthRatio: 1, threshold: null },
        { cropXRatio: 0, cropWidthRatio: 1, threshold: 140 },
        { cropXRatio: 0, cropWidthRatio: 0.72, threshold: null },
        { cropXRatio: 0, cropWidthRatio: 0.72, threshold: 140 },
      ];

      const toVariantObjectUrl = async (
        cropX: number,
        cropY: number,
        cropWidth: number,
        cropHeight: number,
        threshold: number | null
      ) => {
        const maxPixels = 2_400_000;
        const desiredScale = Math.min(2.2, Math.max(1, 1400 / Math.max(1, cropWidth)));
        let outW = Math.max(1, Math.floor(cropWidth * desiredScale));
        let outH = Math.max(1, Math.floor(cropHeight * desiredScale));

        if (outW * outH > maxPixels) {
          const limiter = Math.sqrt(maxPixels / (outW * outH));
          outW = Math.max(1, Math.floor(outW * limiter));
          outH = Math.max(1, Math.floor(outH * limiter));
        }

        canvas.width = outW;
        canvas.height = outH;
        ctx.clearRect(0, 0, outW, outH);
        ctx.drawImage(sourceImage, cropX, cropY, cropWidth, cropHeight, 0, 0, outW, outH);

        if (threshold !== null) {
          const imgData = ctx.getImageData(0, 0, outW, outH);
          const data = imgData.data;
          for (let i = 0; i < data.length; i += 4) {
            const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            const bw = lum >= threshold ? 255 : 0;
            data[i] = bw;
            data[i + 1] = bw;
            data[i + 2] = bw;
          }
          ctx.putImageData(imgData, 0, 0);
        }

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (value) => {
              if (!value) {
                reject(new Error("No se pudo serializar la imagen."));
                return;
              }
              resolve(value);
            },
            "image/jpeg",
            0.92
          );
        });

        return URL.createObjectURL(blob);
      };

      for (const variant of variants) {
        const cropX = Math.floor(sourceImage.naturalWidth * variant.cropXRatio);
        const cropWidth = Math.max(1, Math.floor(sourceImage.naturalWidth * variant.cropWidthRatio));
        const cropY = 0;
        const cropHeight = sourceImage.naturalHeight;

        let variantUrl = "";
        try {
          variantUrl = await toVariantObjectUrl(
            cropX,
            cropY,
            cropWidth,
            cropHeight,
            variant.threshold
          );
          const variantImg = await loadImage(variantUrl);
          const value = await decodeImage(variantImg);
          if (value) return value;
        } catch {
          // Intenta siguiente variante.
        } finally {
          if (variantUrl) {
            URL.revokeObjectURL(variantUrl);
          }
        }

        // Cede un tick al navegador para evitar congelamientos/reloads por carga.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      throw new Error("No se detecto codigo en la imagen.");
    } finally {
      URL.revokeObjectURL(objectUrl);
      reader.reset();
    }
  }, []);

  const openPhotoScanner = useCallback(() => {
    const input = photoInputRef.current;
    if (!input) {
      toast.error("No se pudo abrir la camara por foto.");
      return;
    }
    input.value = "";
    input.click();
  }, []);

  const handlePhotoInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setPhotoScanning(true);
      try {
        const value = await decodeBarcodeFromImageFile(file);
        setProductCode(value);
        toast.success(`Codigo detectado: ${value}`);
        await searchProductByCode(value);
      } catch {
        if (!session?.sessionId) {
          toast.error("Sesion movil no valida.");
          return;
        }

        toast.info("No se detecto barcode. Intentando leer texto de la etiqueta...");

        let candidates: string[] = [];
        try {
          candidates = await readLabelCandidatesWithOcr(file);
        } catch {
          toast.error("No se pudo leer texto de la etiqueta. Intenta con mejor luz/enfoque.");
          return;
        }

        if (candidates.length === 0) {
          toast.error("No se detecto codigo util en la etiqueta.");
          return;
        }

        let foundCandidate = "";
        let foundProduct: StockMobileProduct | null = null;

        for (const candidate of candidates) {
          try {
            const found = await findStockMobileProductByCode(candidate, session.sessionId);
            if (found) {
              foundCandidate = candidate;
              foundProduct = found;
              break;
            }
          } catch {
            // Continua con siguiente candidato OCR.
          }
        }

        if (!foundProduct || !foundCandidate) {
          toast.error("Leimos la etiqueta, pero no coincide con productos del inventario.");
          return;
        }

        setProductCode(foundCandidate);
        setProduct(foundProduct);
        setCountedStockInput(String(foundProduct.stock));
        toast.success(`Producto encontrado por texto: ${foundCandidate}`);
      } finally {
        setPhotoScanning(false);
        event.target.value = "";
      }
    },
    [decodeBarcodeFromImageFile, readLabelCandidatesWithOcr, searchProductByCode, session]
  );

  const handleOpenCameraScanner = async () => {
    if (!isOnline) {
      toast.error("Sin internet. Reintenta cuando vuelva la red.");
      return;
    }

    if (typeof window === "undefined") return;

    if (!window.isSecureContext) {
      toast.info("En HTTP abriremos camara por foto para escanear.");
      openPhotoScanner();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      toast.info("Tu navegador no permite camara en vivo. Abriremos camara por foto.");
      openPhotoScanner();
      return;
    }

    const detectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector;
    if (!detectorCtor) {
      toast.info("Tu navegador no soporta escaneo en vivo. Abriremos camara por foto.");
      openPhotoScanner();
      return;
    }

    setScannerLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      scannerStreamRef.current = stream;
      scannerDetectorRef.current = new detectorCtor({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"],
      });

      setScannerOpen(true);

      const video = videoRef.current;
      if (!video) {
        throw new Error("No se pudo inicializar la vista de camara.");
      }

      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();

      const scanLoop = async () => {
        const currentVideo = videoRef.current;
        const detector = scannerDetectorRef.current;
        if (!currentVideo || !detector) return;

        if (currentVideo.readyState >= 2) {
          try {
            const found = await detector.detect(currentVideo);
            const value = (found.find((item) => item.rawValue?.trim())?.rawValue || "").trim();
            if (value) {
              stopCameraScanner();
              setProductCode(value);
              toast.success(`Codigo detectado: ${value}`);
              await searchProductByCode(value);
              return;
            }
          } catch {
            // Ignora lecturas fallidas y sigue escaneando.
          }
        }

        scannerFrameRef.current = window.requestAnimationFrame(() => {
          void scanLoop();
        });
      };

      scannerFrameRef.current = window.requestAnimationFrame(() => {
        void scanLoop();
      });
    } catch (error) {
      const message = getErrorMessage(error, "No se pudo abrir la camara.");
      toast.error(message);
      stopCameraScanner();
    } finally {
      setScannerLoading(false);
    }
  };

  const handleApplyAdjustment = async () => {
    if (!session) {
      toast.error("Sesion movil no valida.");
      return;
    }

    if (!product) {
      toast.error("Primero selecciona un producto.");
      return;
    }

    const parsed = Number(countedStockInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Conteo fisico invalido.");
      return;
    }

    if (!isOnline) {
      toast.error("Sin internet. Reintenta cuando vuelva la red.");
      return;
    }

    setSubmittingAdjustment(true);
    try {
      const result = await applyStockCountAdjustment({
        productId: product.id,
        countedStock: parsed,
        expectedRevision: product.stockRevision,
        reason: "physical_count",
        source: "mobile_count",
        sessionId: session.sessionId,
      });

      if (result.status === "conflict") {
        setProduct((current) =>
          current
            ? {
                ...current,
                stock: result.stockAfter,
                stockRevision: result.newRevision,
              }
            : current
        );
        setCountedStockInput(String(result.stockAfter));
        toast.error(
          `Conflicto de revision. Stock actual: ${result.stockAfter}, revision: ${result.newRevision}.`
        );
        return;
      }

      setProduct((current) =>
        current
          ? {
              ...current,
              stock: result.stockAfter,
              stockRevision: result.newRevision,
            }
          : current
      );
      setCountedStockInput(String(result.stockAfter));
      toast.success(
        result.delta === 0
          ? "Conteo confirmado sin cambios."
          : `Ajuste aplicado: ${result.delta > 0 ? "+" : ""}${result.delta} unidades.`
      );
    } catch (error) {
      const message = getErrorMessage(error, "No se pudo aplicar el ajuste.");
      toast.error(message);
    } finally {
      setSubmittingAdjustment(false);
    }
  };

  const handleManualHeartbeat = async () => {
    if (!session) return;
    if (!isOnline) {
      toast.error("Sin internet. Reintenta cuando vuelva la red.");
      return;
    }

    setHeartbeatLoading(true);
    try {
      const alive = await touchMobileSession(session.sessionId);
      if (!alive) {
        toast.error("Sesion expirada o revocada.");
        logoutSession();
        return;
      }
      toast.success("Sesion valida.");
    } catch (error) {
      const message = getErrorMessage(error, "No se pudo validar la sesion.");
      toast.error(message);
    } finally {
      setHeartbeatLoading(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-xl bg-slate-50 px-3 py-4">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Smartphone className="h-5 w-5 text-indigo-600" />
          Stock Movil
        </h1>
        <p className="text-sm text-slate-500">Ajuste por conteo fisico con control de concurrencia.</p>
      </div>

      <div
        className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
          isOnline
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-rose-200 bg-rose-50 text-rose-700"
        }`}
      >
        {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        {isOnline ? "Online" : "Sin internet. Reintenta cuando vuelva la red."}
      </div>

      {!session ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Ingreso rapido</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Operador (opcional)
              </label>
              <Input
                value={operatorName}
                onChange={(event) => setOperatorName(event.target.value)}
                placeholder="Ej: Maria"
                className="h-10"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Codigo o token QR
              </label>
              <Input
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value)}
                placeholder="Ej: 731482 o token QR"
                className="h-10 font-mono"
                autoFocus
              />
            </div>

            <Button
              type="button"
              onClick={handleConsumeCode}
              disabled={loginLoading || !isOnline}
              className="h-10 w-full bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {loginLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              Entrar al modulo de stock
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span>Sesion activa</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={logoutSession}
                >
                  <LogOut className="mr-1.5 h-3.5 w-3.5" />
                  Salir
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-slate-700">
                Operador:{" "}
                <span className="font-semibold text-slate-900">
                  {session.operatorName?.trim() || "Operador"}
                </span>
              </p>
              <p className="text-slate-700">
                Expira:{" "}
                <span className="font-semibold text-slate-900">
                  {formatEcuadorDateTime(session.expiresAt)}
                </span>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleManualHeartbeat}
                disabled={heartbeatLoading || !isOnline}
              >
                {heartbeatLoading ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                )}
                Verificar sesion
              </Button>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Sincronizar realidad</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(event) => {
                    void handlePhotoInputChange(event);
                  }}
                />
                <Input
                  value={productCode}
                  onChange={(event) => setProductCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !searchingProduct) {
                      event.preventDefault();
                      void handleSearchProduct();
                    }
                  }}
                  placeholder="Escanea o escribe barcode, SKU o nombre"
                  className="h-10"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-3"
                  onClick={handleOpenCameraScanner}
                  disabled={scannerLoading || photoScanning || !isOnline}
                  title="Abrir camara"
                >
                  {scannerLoading || photoScanning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-3"
                  onClick={handleSearchProduct}
                  disabled={searchingProduct || !isOnline}
                >
                  {searchingProduct ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {scannerOpen ? (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                      Escaner con camara
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 border-indigo-200 px-2 text-indigo-700 hover:bg-indigo-100"
                      onClick={stopCameraScanner}
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Cerrar
                    </Button>
                  </div>
                  <video
                    ref={videoRef}
                    className="h-52 w-full rounded-md border border-indigo-100 bg-black object-cover"
                    autoPlay
                    muted
                    playsInline
                  />
                  <p className="mt-2 text-xs text-indigo-900">
                    Apunta al codigo de barras. Se detecta automaticamente.
                  </p>
                </div>
              ) : null}

              {product ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="font-semibold text-slate-900">{product.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {product.sku ? `SKU ${product.sku} | ` : ""}BAR {product.barcode}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Socia:{" "}
                    <span className="font-semibold" style={{ color: product.owner.color }}>
                      {product.owner.displayName}
                    </span>
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Sistema dice</p>
                      <p className="text-xl font-semibold text-slate-900">{product.stock}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Revision actual</p>
                      <p className="text-xl font-semibold text-slate-900">{product.stockRevision}</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Conteo fisico
                    </label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={countedStockInput}
                      onChange={(event) => setCountedStockInput(event.target.value)}
                      className="h-10"
                    />
                  </div>

                  <Button
                    type="button"
                    onClick={handleApplyAdjustment}
                    disabled={submittingAdjustment || !isOnline}
                    className="mt-3 h-10 w-full bg-indigo-600 text-white hover:bg-indigo-700"
                  >
                    {submittingAdjustment ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Aplicar ajuste por conteo
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
                  Busca una prenda para empezar.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Si otra persona cambia el stock del mismo producto al mismo tiempo, te pediremos confirmar
              el conteo para no guardar un numero desactualizado.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

export default function StockMovilPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto min-h-screen w-full max-w-xl bg-slate-50 px-3 py-4">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">
            Cargando modulo movil...
          </div>
        </main>
      }
    >
      <StockMovilPageInner />
    </Suspense>
  );
}
