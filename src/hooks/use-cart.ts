/**
 * @file use-cart.ts
 * @description Store global del carrito de ventas usando Zustand.
 */

import { create } from "zustand";
import type {
  CartItem,
  CartMutationResult,
  PaymentMethod,
  PriceTier,
  ProductWithOwner,
  PartnerSaleSummary,
} from "@/types/database";
import { getPriceForTier } from "@/lib/pricing";

type SelectablePriceTier = Exclude<PriceTier, "manual">;

function buildCartItemId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function getCartItemTierPrice(item: CartItem, tier: SelectablePriceTier) {
  return getPriceForTier(item, tier);
}

interface CartState {
  items: CartItem[];
  selectedPriceTier: SelectablePriceTier;
  paymentMethod: PaymentMethod | null;
  isProcessing: boolean;
  addItem: (
    product: ProductWithOwner,
    tierOverride?: SelectablePriceTier
  ) => CartMutationResult;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => CartMutationResult;
  updatePrice: (itemId: string, newPrice: number) => void;
  updatePriceTier: (itemId: string, tier: SelectablePriceTier) => CartMutationResult;
  setSelectedPriceTier: (tier: SelectablePriceTier) => void;
  setPaymentMethod: (method: PaymentMethod | null) => void;
  clearCart: () => void;
  setProcessing: (value: boolean) => void;
  getTotal: () => number;
  getItemCount: () => number;
  getPartnerSummaries: () => PartnerSaleSummary[];
  notes: string;
  amountReceived: string;
  setNotes: (notes: string) => void;
  setAmountReceived: (amount: string) => void;
}

export const useCart = create<CartState>((set, get) => ({
  items: [],
  selectedPriceTier: "normal",
  paymentMethod: null,
  isProcessing: false,
  notes: "",
  amountReceived: "",

  addItem: (product: ProductWithOwner, tierOverride?: SelectablePriceTier) => {
    // Allow putting items without stock to continue with the process.
    const selectedTier = tierOverride ?? get().selectedPriceTier;
    const selectedPrice = getPriceForTier(product, selectedTier);

    if (selectedPrice === null || selectedPrice === undefined || selectedPrice <= 0) {
      return {
        ok: false,
        reason: "price_tier_unavailable",
        availableStock: product.stock,
        appliedTier: selectedTier,
      };
    }

    let result: CartMutationResult = {
      ok: true,
      availableStock: product.stock,
      appliedPrice: selectedPrice,
      appliedTier: selectedTier,
    };

    set((state) => {
      const existingIndex = state.items.findIndex(
        (item) => item.product_id === product.id
      );

      if (existingIndex >= 0) {
        const updated = [...state.items];
        const item = { ...updated[existingIndex] };

        result = {
          ok: true,
          availableStock: product.stock,
          appliedPrice: item.price_override,
          appliedTier: item.price_tier,
        };

        item.quantity += 1;
        item.available_stock = product.stock;
        item.subtotal = item.quantity * item.price_override;
        updated[existingIndex] = item;
        return { items: updated };
      }

      // NOTE: clearance_price logic hidden. See docs/ropa-vieja.md to reactivate.
      const newItem: CartItem = {
        id: buildCartItemId(),
        product_id: product.id,
        barcode: product.barcode,
        sku: product.sku,
        name: product.name,
        owner_id: product.owner_id,
        owner_name: product.owner.name,
        owner_display_name: product.owner.display_name,
        owner_color: product.owner.color_hex,
        available_stock: product.stock,
        sale_price: product.sale_price,
        sale_price_x3: product.sale_price_x3,
        sale_price_x6: product.sale_price_x6,
        sale_price_x12: product.sale_price_x12,
        unit_price: selectedPrice,
        price_tier: selectedTier,
        price_override: selectedPrice,
        quantity: 1,
        subtotal: selectedPrice,
      };

      return { items: [...state.items, newItem] };
    });

    return result;
  },

  removeItem: (itemId: string) => {
    set((state) => ({
      items: state.items.filter((item) => item.id !== itemId),
    }));
  },

  updateQuantity: (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(itemId);
      return { ok: true };
    }

    const existingItem = get().items.find((item) => item.id === itemId);
    if (!existingItem) {
      return { ok: false, reason: "not_found" };
    }

    // Removed available_stock quantity limitation check to allow selling items even if out of stock


    set((state) => ({
      items: state.items.map((item) =>
        item.id === itemId
          ? { ...item, quantity, subtotal: quantity * item.price_override }
          : item
      ),
    }));

    return { ok: true, availableStock: existingItem.available_stock };
  },

  updatePrice: (itemId: string, newPrice: number) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              unit_price: newPrice,
              price_tier: "manual",
              price_override: newPrice,
              subtotal: item.quantity * newPrice,
            }
          : item
      ),
    }));
  },

  updatePriceTier: (itemId: string, tier: SelectablePriceTier) => {
    const existingItem = get().items.find((item) => item.id === itemId);
    if (!existingItem) {
      return { ok: false, reason: "not_found" };
    }

    const nextPrice = getCartItemTierPrice(existingItem, tier);
    if (nextPrice === null || nextPrice === undefined || nextPrice <= 0) {
      return {
        ok: false,
        reason: "price_tier_unavailable",
        availableStock: existingItem.available_stock,
        appliedTier: tier,
      };
    }

    set((state) => ({
      items: state.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              unit_price: nextPrice,
              price_tier: tier,
              price_override: nextPrice,
              subtotal: item.quantity * nextPrice,
            }
          : item
      ),
    }));

    return {
      ok: true,
      availableStock: existingItem.available_stock,
      appliedPrice: nextPrice,
      appliedTier: tier,
    };
  },

  setSelectedPriceTier: (tier: SelectablePriceTier) => {
    set({ selectedPriceTier: tier });
  },

  setPaymentMethod: (method: PaymentMethod | null) => {
    set({ paymentMethod: method });
  },

  clearCart: () => {
    set({ items: [], paymentMethod: null, isProcessing: false, notes: "", amountReceived: "" });
  },

  setProcessing: (value: boolean) => {
    set({ isProcessing: value });
  },

  setNotes: (notes: string) => {
    set({ notes });
  },

  setAmountReceived: (amount: string) => {
    set({ amountReceived: amount });
  },

  getTotal: () => {
    return get().items.reduce((sum, item) => sum + item.subtotal, 0);
  },

  getItemCount: () => {
    return get().items.reduce((count, item) => count + item.quantity, 0);
  },

  getPartnerSummaries: () => {
    const items = get().items;
    const summaryMap = new Map<string, PartnerSaleSummary>();

    for (const item of items) {
      const existing = summaryMap.get(item.owner_id);
      if (existing) {
        existing.total += item.subtotal;
        existing.item_count += item.quantity;
      } else {
        summaryMap.set(item.owner_id, {
          partner_id: item.owner_id,
          partner_name: item.owner_name,
          display_name: item.owner_display_name,
          color_hex: item.owner_color,
          total: item.subtotal,
          item_count: item.quantity,
        });
      }
    }

    return Array.from(summaryMap.values());
  },
}));
