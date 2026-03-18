/**
 * @file use-barcode-scanner.ts
 * @description Hook para escuchar entrada de pistola de codigos de barras (HID).
 */

import { useEffect, useRef } from "react";
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

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isInputFocused) return;

      const now = Date.now();

      if (
        e.key === "Enter" &&
        bufferRef.current.length >= SCANNER_CONFIG.MIN_LENGTH
      ) {
        e.preventDefault();
        onScanRef.current(bufferRef.current.trim());
        bufferRef.current = "";
        return;
      }

      if (e.key.length === 1) {
        if (now - lastKeyTimeRef.current > SCANNER_CONFIG.TIMEOUT_MS) {
          bufferRef.current = "";
        }

        bufferRef.current += e.key;
        lastKeyTimeRef.current = now;

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          bufferRef.current = "";
        }, SCANNER_CONFIG.TIMEOUT_MS);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled]);
}
