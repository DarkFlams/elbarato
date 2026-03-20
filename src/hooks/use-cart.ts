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
  paymentMethod: PaymentMethod | null;
  isProcessing: boolean;
  addItem: (product: ProductWithOwner) => CartMutationResult;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => CartMutationResult;
  updatePrice: (productId: string, newPrice: number) => void;
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
  paymentMethod: null,
  isProcessing: false,
  notes: "",
  amountReceived: "",

  addItem: (product: ProductWithOwner) => {
    // Allow putting items without stock to continue with the process.

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

        item.quantity += 1;
        item.available_stock = product.stock;
        item.subtotal = item.quantity * item.unit_price;
        updated[existingIndex] = item;
        return { items: updated };
      }

      // NOTE: clearance_price logic hidden. See docs/ropa-vieja.md to reactivate.
      const newItem: CartItem = {
        product_id: product.id,
        barcode: product.barcode,
        sku: product.sku,
        name: product.name,
        owner_id: product.owner_id,
        owner_name: product.owner.name,
        owner_display_name: product.owner.display_name,
        owner_color: product.owner.color_hex,
        available_stock: product.stock,
        unit_price: product.sale_price,
        price_override: product.sale_price, // Inicialmente es el precio original
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

    // Removed available_stock quantity limitation check to allow selling items even if out of stock


    set((state) => ({
      items: state.items.map((item) =>
        item.product_id === productId
          ? { ...item, quantity, subtotal: quantity * item.price_override }
          : item
      ),
    }));

    return { ok: true, availableStock: existingItem.available_stock };
  },

  updatePrice: (productId: string, newPrice: number) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.product_id === productId
          ? { ...item, price_override: newPrice, subtotal: item.quantity * newPrice }
          : item
      ),
    }));
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
