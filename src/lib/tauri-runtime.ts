export function isTauriRuntime() {
  if (typeof window === "undefined") return false;

  return (
    navigator.userAgent.includes("Tauri") ||
    "__TAURI_INTERNALS__" in window
  );
}

export function isMissingTauriCommandError(error: unknown) {
  if (typeof error === "string") {
    return /command .+ not found/i.test(error);
  }

  if (error instanceof Error) {
    return /command .+ not found/i.test(error.message);
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" && /command .+ not found/i.test(message);
  }

  return false;
}
