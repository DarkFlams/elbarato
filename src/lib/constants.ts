// Partner presets for legacy screens that still rely on fixed labels.
export const PARTNERS = {
  rosa: {
    id: "rosa",
    displayName: "Rosa",
    color: "#C026D3",
    colorLight: "rgba(192, 38, 211, 0.12)",
    emoji: "R",
  },
  lorena: {
    id: "lorena",
    displayName: "Lorena",
    color: "#2F9E8F",
    colorLight: "rgba(47, 158, 143, 0.12)",
    emoji: "L",
  },
  yadira: {
    id: "yadira",
    displayName: "Yadira",
    color: "#4C6FFF",
    colorLight: "rgba(76, 111, 255, 0.12)",
    emoji: "Y",
  },
  todos: {
    id: "todos",
    displayName: "Medias",
    color: "#8B7A62",
    colorLight: "rgba(139, 122, 98, 0.12)",
    emoji: "M",
  },
} as const;

export type PartnerKey = keyof typeof PARTNERS;

export const PAYMENT_METHODS = [
  { id: "cash", label: "Efectivo", icon: "Banknote" },
  { id: "transfer", label: "Transferencia", icon: "Smartphone" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["id"];

export const APP_NAME = "POS Tienda de Ropa";
export const APP_DESCRIPTION = "Sistema de Punto de Venta y Control de Gastos";
export const APP_VERSION = "0.1.12";
export const CURRENCY = "USD";
export const CURRENCY_SYMBOL = "$";

export const SCANNER_CONFIG = {
  THRESHOLD_MS: 50,
  MIN_LENGTH: 4,
  TIMEOUT_MS: 500,
} as const;
