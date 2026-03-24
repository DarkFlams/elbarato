"use client";

import { invoke } from "@tauri-apps/api/core";
import { isMissingTauriCommandError, isTauriRuntime } from "@/lib/tauri-runtime";

const TICKET_PRINTER_SETTING_KEY = "ticket_printer_name";
const TICKET_AUTO_PRINT_SETTING_KEY = "ticket_auto_print_enabled";
const LABEL_PRINTER_SETTING_KEY = "label_printer_name";

interface LocalAppSettingRecord {
  key: string;
  value: string;
}

export interface LocalPrinterInfo {
  name: string;
  isDefault: boolean;
  isOffline: boolean;
  printerStatus: number | null;
  isVirtual: boolean;
}

export async function listLocalPrinters(): Promise<LocalPrinterInfo[]> {
  if (!isTauriRuntime()) return [];

  try {
    return await invoke<LocalPrinterInfo[]>("list_local_printers");
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return [];
  }
}

export async function getSavedTicketPrinterName(): Promise<string | null> {
  if (!isTauriRuntime()) return null;

  try {
    const result = await invoke<LocalAppSettingRecord | null>("get_local_app_setting", {
      key: TICKET_PRINTER_SETTING_KEY,
    });

    const value = result?.value?.trim();
    return value ? value : null;
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return null;
  }
}

export async function setSavedTicketPrinterName(printerName: string | null): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  try {
    return await invoke<boolean>("set_local_app_setting", {
      key: TICKET_PRINTER_SETTING_KEY,
      value: printerName?.trim() || "",
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return false;
  }
}

export async function getSavedLabelPrinterName(): Promise<string | null> {
  if (!isTauriRuntime()) return null;

  try {
    const result = await invoke<LocalAppSettingRecord | null>("get_local_app_setting", {
      key: LABEL_PRINTER_SETTING_KEY,
    });

    const value = result?.value?.trim();
    return value ? value : null;
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return null;
  }
}

export async function setSavedLabelPrinterName(printerName: string | null): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  try {
    return await invoke<boolean>("set_local_app_setting", {
      key: LABEL_PRINTER_SETTING_KEY,
      value: printerName?.trim() || "",
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return false;
  }
}

function parseBooleanSetting(value: string | null | undefined, fallback: boolean) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  return !["0", "false", "off", "no"].includes(normalized);
}

export async function getTicketAutoPrintEnabled(): Promise<boolean> {
  if (!isTauriRuntime()) return true;

  try {
    const result = await invoke<LocalAppSettingRecord | null>("get_local_app_setting", {
      key: TICKET_AUTO_PRINT_SETTING_KEY,
    });

    return parseBooleanSetting(result?.value, true);
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return true;
  }
}

export async function setTicketAutoPrintEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  try {
    return await invoke<boolean>("set_local_app_setting", {
      key: TICKET_AUTO_PRINT_SETTING_KEY,
      value: enabled ? "true" : "false",
    });
  } catch (error) {
    if (!isMissingTauriCommandError(error)) throw error;
    return false;
  }
}
