export function getErrorMessage(error: unknown, fallback = "Ocurrio un error inesperado.") {
  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed || fallback;
  }

  if (error instanceof Error) {
    const trimmed = error.message.trim();
    return trimmed || fallback;
  }

  if (error && typeof error === "object") {
    const err = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      error_description?: unknown;
    };

    const parts: string[] = [];

    if (typeof err.message === "string" && err.message.trim()) {
      parts.push(err.message.trim());
    }
    if (typeof err.details === "string" && err.details.trim()) {
      parts.push(err.details.trim());
    }
    if (typeof err.hint === "string" && err.hint.trim()) {
      parts.push(`Hint: ${err.hint.trim()}`);
    } else if (typeof err.error_description === "string" && err.error_description.trim()) {
      parts.push(err.error_description.trim());
    }

    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }

  return fallback;
}
