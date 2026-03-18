import type { Partner } from "@/types/database";

type PartnerPreset = {
  displayName: string;
  color: string;
};

const PARTNER_PRESETS: Record<string, PartnerPreset> = {
  rosa: {
    displayName: "Rosa",
    color: "#C026D3",
  },
  lorena: {
    displayName: "Lorena",
    color: "#2F9E8F",
  },
  yadira: {
    displayName: "Yadira",
    color: "#4C6FFF",
  },
  todos: {
    displayName: "Todos",
    color: "#8B7A62",
  },
};

function normalizePartnerKey(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace("#", "").trim();
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    return null;
  }

  const parsed = parseInt(value, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(71, 85, 105, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function fallbackColor(name: string): string {
  const source = name || "partner";
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = source.charCodeAt(index) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 52%)`;
}

export function getPartnerConfig(input: {
  name?: string | null;
  displayName?: string | null;
  colorHex?: string | null;
}) {
  const normalizedName = normalizePartnerKey(input.name);
  const preset = PARTNER_PRESETS[normalizedName];
  const color = input.colorHex || preset?.color || fallbackColor(normalizedName);
  const displayName =
    input.displayName || preset?.displayName || input.name || "Sin nombre";

  return {
    key: normalizedName || normalizePartnerKey(displayName),
    displayName,
    color,
    colorLight: rgba(color, 0.12),
    colorBorder: rgba(color, 0.28),
    badgeText: displayName.slice(0, 1).toUpperCase(),
  };
}

export function getPartnerConfigFromPartner(
  partner:
    | Pick<Partner, "name" | "display_name" | "color_hex">
    | null
    | undefined
) {
  return getPartnerConfig({
    name: partner?.name,
    displayName: partner?.display_name,
    colorHex: partner?.color_hex,
  });
}

export function getPartnerConfigFromSummary(summary: {
  partner?: string | null;
  display_name?: string | null;
  color_hex?: string | null;
}) {
  return getPartnerConfig({
    name: summary.partner,
    displayName: summary.display_name,
    colorHex: summary.color_hex,
  });
}

export function buildPartnerName(displayName: string): string {
  const normalized = normalizePartnerKey(displayName);
  return normalized || `partner${Date.now()}`;
}

export function getDefaultPartnerColor(displayName: string): string {
  const normalized = normalizePartnerKey(displayName);
  const preset = PARTNER_PRESETS[normalized];
  return preset?.color || fallbackColor(displayName);
}
