"use client";

import { check, type Update } from "@tauri-apps/plugin-updater";

export interface UpdateStatus {
  available: boolean;
  version: string | null;
  notes: string | null;
  date: string | null;
  error: string | null;
}

export async function checkForAppUpdate(): Promise<{
  status: UpdateStatus;
  update: Update | null;
}> {
  try {
    const update = await check();
    if (!update) {
      return {
        status: {
          available: false,
          version: null,
          notes: null,
          date: null,
          error: null,
        },
        update: null,
      };
    }

    return {
      status: {
        available: true,
        version: update.version,
        notes: update.body ?? null,
        date: update.date ?? null,
        error: null,
      },
      update,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
        ? error
        : "No se pudo consultar actualizaciones";

    return {
      status: {
        available: false,
        version: null,
        notes: null,
        date: null,
        error: message,
      },
      update: null,
    };
  }
}
