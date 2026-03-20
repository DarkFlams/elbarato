const ECUADOR_TZ = "America/Guayaquil";
const ECUADOR_OFFSET_HOURS = 5; // UTC = Ecuador + 5h

type DateInput = string | number | Date | null | undefined;

function hasExplicitTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function normalizeSqliteTimestamp(value: string): string {
  const trimmed = value.trim();
  // SQLite CURRENT_TIMESTAMP: "YYYY-MM-DD HH:MM:SS"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    return `${trimmed.replace(" ", "T")}Z`;
  }

  // Naive ISO from backend without timezone -> treat as UTC.
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed) &&
    !hasExplicitTimezone(trimmed)
  ) {
    return `${trimmed}Z`;
  }

  return trimmed;
}

export function toDateFromBackend(value: DateInput): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value !== "string" || value.trim().length === 0) return new Date(NaN);

  const normalized = normalizeSqliteTimestamp(value);
  return new Date(normalized);
}

function safeFormat(
  value: DateInput,
  locale: string,
  options: Intl.DateTimeFormatOptions
): string {
  const date = toDateFromBackend(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, { timeZone: ECUADOR_TZ, ...options }).format(date);
}

export function formatEcuadorDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions
): string {
  return safeFormat(value, "es-EC", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  });
}

export function formatEcuadorTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions
): string {
  return safeFormat(value, "es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}

export function formatEcuadorDateTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions
): string {
  return safeFormat(value, "es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...options,
  });
}

export function toEcuadorDateInput(value: DateInput = new Date()): string {
  const date = toDateFromBackend(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ECUADOR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((part) => part.type === "year")?.value ?? "0000";
  const m = parts.find((part) => part.type === "month")?.value ?? "01";
  const d = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function ecuadorDayKey(value: DateInput = new Date()): string {
  return toEcuadorDateInput(value);
}

function parseDateInput(dateInput: string): { year: number; month: number; day: number } | null {
  const trimmed = dateInput.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function ecuadorDateStartUtcIso(dateInput: string): string {
  const parsed = parseDateInput(dateInput);
  if (!parsed) return "";
  const utcMs = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    ECUADOR_OFFSET_HOURS,
    0,
    0,
    0
  );
  return new Date(utcMs).toISOString();
}

export function ecuadorDateEndUtcIso(dateInput: string): string {
  const parsed = parseDateInput(dateInput);
  if (!parsed) return "";
  const utcMs = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day + 1,
    ECUADOR_OFFSET_HOURS - 1,
    59,
    59,
    999
  );
  return new Date(utcMs).toISOString();
}

export const ECUADOR_TIMEZONE = ECUADOR_TZ;
