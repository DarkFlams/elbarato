/**
 * @file use-cart.ts
 * @description Store global del carrito de ventas usando Zustand.
 */

import { create } from "zustand";
import type {
  CartItem,
  CartMutationResult,
  PaymentMethod,
  ProductWithOwner,
  PartnerSaleSummary,
} from "@/types/database";

interface CartState {
  items: CartItem[];
  paymentMethod: PaymentMethod;
  isProcessing: boolean;
  addItem: (product: ProductWithOwner) => CartMutationResult;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => CartMutationResult;
  setPaymentMethod: (method: PaymentMethod) => void;
  clearCart: () => void;
  setProcessing: (value: boolean) => void;
  getTotal: () => number;
  getItemCount: () => number;
  getPartnerSummaries: () => PartnerSaleSummary[];
}

export const useCart = create<CartState>((set, get) => ({
  items: [],
  paymentMethod: "cash",
  isProcessing: false,

  addItem: (product: ProductWithOwner) => {
    if (product.stock <= 0) {
      return {
        ok: false,
        reason: "out_of_stock",
        availableStock: product.stock,
      };
    }

    let result: CartMutationResult = {
      ok: true,
      availableStock: product.stock,
    };

    set((state) => {
      const existingIndex = state.items.findIndex(
        (item) => item.product_id === product.id
      );

      if (existingIndex >= 0) {
        const updated = [...state.items];
        const item = { ...updated[existingIndex] };

        if (item.quantity >= item.available_stock) {
          result = {
            ok: false,
            reason: "quantity_limit",
            availableStock: item.available_stock,
          };
          return { items: state.items };
        }

        item.quantity += 1;
        item.available_stock = product.stock;
        item.subtotal = item.quantity * item.unit_price;
        updated[existingIndex] = item;
        return { items: updated };
      }

      const newItem: CartItem = {
        product_id: product.id,
        barcode: product.barcode,
        name: product.name,
        owner_id: product.owner_id,
        owner_name: product.owner.name,
        owner_display_name: product.owner.display_name,
        owner_color: product.owner.color_hex,
        available_stock: product.stock,
        unit_price: product.sale_price,
        quantity: 1,
        subtotal: product.sale_price,
      };

      return { items: [...state.items, newItem] };
    });

    return result;
  },

  removeItem: (productId: string) => {
    set((state) => ({
      items: state.items.filter((item) => item.product_id !== productId),
    }));
  },

  updateQuantity: (productId: string, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return { ok: true };
    }

    const existingItem = get().items.find((item) => item.product_id === productId);
    if (!existingItem) {
      return { ok: false, reason: "not_found" };
    }

    if (quantity > existingItem.available_stock) {
      return {
        ok: false,
        reason: "quantity_limit",
        availableStock: existingItem.available_stock,
      };
    }

    set((state) => ({
      items: state.items.map((item) =>
        item.product_id === productId
          ? { ...item, quantity, subtotal: quantity * item.unit_price }
          : item
      ),
    }));

    return { ok: true, availableStock: existingItem.available_stock };
  },

  setPaymentMethod: (method: PaymentMethod) => {
    set({ paymentMethod: method });
  },

  clearCart: () => {
    set({ items: [], paymentMethod: "cash", isProcessing: false });
  },

  setProcessing: (value: boolean) => {
    set({ isProcessing: value });
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
