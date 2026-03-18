import type {
  InventoryMovementReason,
} from "@/types/database";

type PartnerVisual = {
  accent: string;
  softBackground: string;
  softBorder: string;
  softText: string;
};

type StockVisual = {
  label: string;
  className: string;
};

type MovementVisual = {
  iconClassName: string;
  badgeClassName: string;
};

const PARTNER_VISUALS: Record<string, PartnerVisual> = {
  rosa: {
    accent: "#C026D3",
    softBackground: "#FDF4FF",
    softBorder: "#F5D0FE",
    softText: "#A21CAF",
  },
  lorena: {
    accent: "#2F9E8F",
    softBackground: "#ECF8F5",
    softBorder: "#BFE7E0",
    softText: "#1F776C",
  },
  yadira: {
    accent: "#4C6FFF",
    softBackground: "#EEF2FF",
    softBorder: "#CAD5FF",
    softText: "#3552CC",
  },
  todos: {
    accent: "#8B7A62",
    softBackground: "#F8F7F5",
    softBorder: "#E5E1DA",
    softText: "#5D5141",
  },
};

const STOCK_VISUALS: Record<"ok" | "low" | "out", StockVisual> = {
  ok: {
    label: "Disponible",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  low: {
    label: "Por agotarse",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  out: {
    label: "Sin stock",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

const MOVEMENT_VISUALS: Record<InventoryMovementReason, MovementVisual> = {
  sale: {
    iconClassName: "bg-sky-100 text-sky-700",
    badgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
  },
  restock: {
    iconClassName: "bg-emerald-100 text-emerald-700",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  manual_adjustment: {
    iconClassName: "bg-amber-100 text-amber-700",
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
  },
  return: {
    iconClassName: "bg-violet-100 text-violet-700",
    badgeClassName: "border-violet-200 bg-violet-50 text-violet-700",
  },
  initial_stock: {
    iconClassName: "bg-indigo-100 text-indigo-700",
    badgeClassName: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
};

export function getPartnerVisual(name: string): PartnerVisual {
  return (
    PARTNER_VISUALS[name] || {
      accent: "#64748B",
      softBackground: "#F1F5F9",
      softBorder: "#CBD5E1",
      softText: "#334155",
    }
  );
}

export function getPartnerInitial(displayName: string): string {
  return displayName.slice(0, 1).toUpperCase();
}

export function getStockTone(stock: number, minStock: number): "ok" | "low" | "out" {
  if (stock <= 0) return "out";
  if (stock <= minStock) return "low";
  return "ok";
}

export function getStockVisual(stock: number, minStock: number): StockVisual {
  return STOCK_VISUALS[getStockTone(stock, minStock)];
}

export function getMovementVisual(reason: InventoryMovementReason): MovementVisual {
  return MOVEMENT_VISUALS[reason];
}
