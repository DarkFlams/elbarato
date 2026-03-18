/**
 * @file use-barcode-scanner.ts
 * @description Hook para escuchar entrada de pistola de códigos de barras (HID).
 *
 * ESTRATEGIA:
 * Las pistolas de códigos de barras actúan como teclados USB.
 * Envían caracteres a velocidad inhumana (~10-30ms entre teclas) seguidos de Enter.
 * Diferenciamos pistola vs humano midiendo la velocidad entre teclas.
 *
 * - Si el intervalo entre teclas es < THRESHOLD_MS → viene de la pistola.
 * - Si el buffer acumula >= MIN_LENGTH caracteres rápidos y termina con Enter → se dispara onScan.
 * - Funciona INCLUSO cuando un <input> tiene el foco: interceptamos los eventos,
 *   limpiamos el texto que la pistola inyectó en el input, y enrutamos al carrito.
 */

import { useEffect, useRef, useCallback } from "react";
import { SCANNER_CONFIG } from "@/lib/constants";

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  enabled?: boolean;
}

export function useBarcodeScanner({
  onScan,
  enabled = true,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onScanRef = useRef(onScan);
  const rapidCountRef = useRef(0);
  const inputSnapshotRef = useRef<{ element: HTMLInputElement | null; valueBefore: string }>({
    element: null,
    valueBefore: "",
  });

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const resetBuffer = useCallback(() => {
    bufferRef.current = "";
    rapidCountRef.current = 0;
    inputSnapshotRef.current = { element: null, valueBefore: "" };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const elapsed = now - lastKeyTimeRef.current;
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // --- Enter: decide if we have a complete scan ---
      if (e.key === "Enter" && bufferRef.current.length >= SCANNER_CONFIG.MIN_LENGTH) {
        e.preventDefault();
        e.stopImmediatePropagation();

        // If the scanner typed into a focused input, revert its polluted value
        if (isInputFocused && inputSnapshotRef.current.element) {
          const el = inputSnapshotRef.current.element;
          const original = inputSnapshotRef.current.valueBefore;
          // Use native setter to trigger React's synthetic onChange properly
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, original);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }

        const barcode = bufferRef.current.trim();
        resetBuffer();
        onScanRef.current(barcode);
        return;
      }

      // --- Printable character ---
      if (e.key.length === 1) {
        // Detect rapid fire (scanner speed)
        const isRapid = elapsed < SCANNER_CONFIG.THRESHOLD_MS;

        if (elapsed > SCANNER_CONFIG.TIMEOUT_MS) {
          // Too slow — reset and start fresh
          resetBuffer();
        }

        // First char of a potential scan: snapshot the input value BEFORE pollution
        if (bufferRef.current.length === 0 && isInputFocused) {
          const el = target as HTMLInputElement;
          inputSnapshotRef.current = {
            element: el,
            valueBefore: el.value ?? "",
          };
        }

        bufferRef.current += e.key;
        lastKeyTimeRef.current = now;

        if (isRapid) {
          rapidCountRef.current++;
        }

        // After 3+ rapid chars we're confident it's a scanner — suppress input
        if (rapidCountRef.current >= 3 && isInputFocused) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }

        // Auto-clear if idle for too long
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          resetBuffer();
        }, SCANNER_CONFIG.TIMEOUT_MS);
      }
    };

    // Use capture phase so we fire BEFORE React or the input handles the event
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, resetBuffer]);
}
