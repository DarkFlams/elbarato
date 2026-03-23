import type { PriceTier, Product } from "@/types/database";

type TierPriceSource = Pick<
  Product,
  "sale_price" | "sale_price_x3" | "sale_price_x6" | "sale_price_x12"
>;

export type ProductPriceField =
  | "sale_price"
  | "sale_price_x3"
  | "sale_price_x6"
  | "sale_price_x12";

export const PRICE_TIER_OPTIONS: Array<{
  value: Exclude<PriceTier, "manual">;
  label: string;
  shortLabel: string;
  field: ProductPriceField;
}> = [
  { value: "normal", label: "PVP normal", shortLabel: "Normal", field: "sale_price" },
  { value: "x3", label: "PVP x3", shortLabel: "x3", field: "sale_price_x3" },
  { value: "x6", label: "PVP x6", shortLabel: "x6", field: "sale_price_x6" },
  { value: "x12", label: "PVP x12", shortLabel: "x12", field: "sale_price_x12" },
];

export function getPriceForTier(
  product: TierPriceSource,
  tier: Exclude<PriceTier, "manual">
) {
  switch (tier) {
    case "normal":
      return product.sale_price;
    case "x3":
      return product.sale_price_x3;
    case "x6":
      return product.sale_price_x6;
    case "x12":
      return product.sale_price_x12;
    default:
      return product.sale_price;
  }
}

export function getPriceFieldForTier(
  tier: Exclude<PriceTier, "manual">
): ProductPriceField {
  return PRICE_TIER_OPTIONS.find((option) => option.value === tier)?.field ?? "sale_price";
}

export function getTierLabel(tier: PriceTier) {
  if (tier === "manual") return "Manual";
  return PRICE_TIER_OPTIONS.find((option) => option.value === tier)?.shortLabel ?? "Normal";
}

export function formatPriceValue(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "--";
  }

  return `$${Number(value).toFixed(2)}`;
}
