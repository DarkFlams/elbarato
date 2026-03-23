export function formatSyncErrorMessage(rawMessage: string | null | undefined) {
  const message = rawMessage?.trim() ?? "";
  if (!message) return "Error de sincronizacion desconocido";

  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function public.upsert_product_with_movement") &&
    normalized.includes("schema cache")
  ) {
    return [
      "Supabase no tiene la version nueva de la RPC upsert_product_with_movement.",
      "Ejecuta primero supabase/schema_patch_existing.sql y luego supabase/functions.sql en Supabase SQL Editor.",
      "Si el SQL ya corrio, ejecuta: NOTIFY pgrst, 'reload schema';",
    ].join(" ");
  }

  return message;
}

export function normalizeSyncErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return formatSyncErrorMessage(error);
  }

  if (error instanceof Error) {
    return formatSyncErrorMessage(error.message);
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return formatSyncErrorMessage(message);
    }
  }

  return "Error de sincronizacion desconocido";
}
