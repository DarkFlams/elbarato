/**
 * @file use-cart.ts
 * @description Store del POS con multiples ventas activas usando Zustand.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  CartItem,
  CartMutationResult,
  PartnerSaleSummary,
  PaymentMethod,
  PriceTier,
  ProductWithOwner,
} from "@/types/database";
import { getPriceForTier } from "@/lib/pricing";

type SelectablePriceTier = Exclude<PriceTier, "manual">;

interface PosSaleDraft {
  id: string;
  label: string;
  items: CartItem[];
  selectedPriceTier: SelectablePriceTier;
  paymentMethod: PaymentMethod | null;
  isProcessing: boolean;
  notes: string;
  amountReceived: string;
  createdAt: number;
  updatedAt: number;
}

interface CartStoreState {
  tabs: PosSaleDraft[];
  activeTabId: string;
  nextTabNumber: number;
  openTab: () => string;
  openTabWithDraft: (draft: {
    items: CartItem[];
    selectedPriceTier?: SelectablePriceTier;
    paymentMethod?: PaymentMethod | null;
    notes?: string;
    amountReceived?: string;
  }) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  addItem: (
    product: ProductWithOwner,
    tierOverride?: SelectablePriceTier
  ) => CartMutationResult;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => CartMutationResult;
  updatePrice: (itemId: string, newPrice: number) => void;
  updatePriceTier: (
    itemId: string,
    tier: SelectablePriceTier
  ) => CartMutationResult;
  setSelectedPriceTier: (tier: SelectablePriceTier) => void;
  setPaymentMethod: (method: PaymentMethod | null) => void;
  clearCart: () => void;
  setProcessing: (value: boolean) => void;
  getTotal: () => number;
  getItemCount: () => number;
  getPartnerSummaries: () => PartnerSaleSummary[];
  setNotes: (notes: string) => void;
  setAmountReceived: (amount: string) => void;
}

const POS_CART_STORAGE_KEY = "dashboard:pos:sale-tabs:v1";

function buildId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function buildDraftLabel(tabNumber: number) {
  return `Venta ${tabNumber}`;
}

function buildDraft(tabNumber: number): PosSaleDraft {
  const now = Date.now();

  return {
    id: buildId(),
    label: buildDraftLabel(tabNumber),
    items: [],
    selectedPriceTier: "normal",
    paymentMethod: null,
    isProcessing: false,
    notes: "",
    amountReceived: "",
    createdAt: now,
    updatedAt: now,
  };
}

function relabelDrafts(tabs: PosSaleDraft[]) {
  return tabs.map((tab, index) => ({
    ...tab,
    label: buildDraftLabel(index + 1),
  }));
}

function createInitialCartState() {
  const firstDraft = buildDraft(1);

  return {
    tabs: [firstDraft],
    activeTabId: firstDraft.id,
    nextTabNumber: 2,
  };
}

function touchDraft(
  draft: PosSaleDraft,
  changes: Partial<PosSaleDraft>
): PosSaleDraft {
  return {
    ...draft,
    ...changes,
    updatedAt: Date.now(),
  };
}

function getActiveDraft(state: Pick<CartStoreState, "tabs" | "activeTabId">) {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
}

function getTabTierPrice(item: CartItem, tier: SelectablePriceTier) {
  return getPriceForTier(item, tier);
}

function ensureStoreShape(
  persistedState?: Partial<CartStoreState> | undefined
): Pick<CartStoreState, "tabs" | "activeTabId" | "nextTabNumber"> {
  const initial = createInitialCartState();

  if (!persistedState || !Array.isArray(persistedState.tabs) || persistedState.tabs.length === 0) {
    return initial;
  }

  const sanitizedTabs = relabelDrafts(persistedState.tabs.map((tab, index) => ({
    id: tab.id || buildId(),
    label: tab.label || buildDraftLabel(index + 1),
    items: Array.isArray(tab.items) ? tab.items : [],
    selectedPriceTier: tab.selectedPriceTier ?? "normal",
    paymentMethod: tab.paymentMethod ?? null,
    isProcessing: false,
    notes: tab.notes ?? "",
    amountReceived: tab.amountReceived ?? "",
    createdAt: Number(tab.createdAt ?? Date.now()),
    updatedAt: Number(tab.updatedAt ?? Date.now()),
  })));

  const activeTabExists = sanitizedTabs.some(
    (tab) => tab.id === persistedState.activeTabId
  );

  return {
    tabs: sanitizedTabs,
    activeTabId: activeTabExists
      ? (persistedState.activeTabId as string)
      : sanitizedTabs[0].id,
    nextTabNumber: sanitizedTabs.length + 1,
  };
}

function mapTabs(
  tabs: PosSaleDraft[],
  targetTabId: string,
  updater: (draft: PosSaleDraft) => PosSaleDraft
) {
  let found = false;

  const nextTabs = tabs.map((draft) => {
    if (draft.id !== targetTabId) return draft;
    found = true;
    return updater(draft);
  });

  return {
    tabs: found ? nextTabs : tabs,
    found,
  };
}

export const useCartStore = create<CartStoreState>()(
  persist(
    (set, get) => ({
      ...createInitialCartState(),

      openTab: () => {
        let nextTabId = "";

        set((state) => {
          const nextDraft = buildDraft(state.tabs.length + 1);
          const nextTabs = relabelDrafts([...state.tabs, nextDraft]);
          nextTabId = nextDraft.id;

          return {
            tabs: nextTabs,
            activeTabId: nextDraft.id,
            nextTabNumber: nextTabs.length + 1,
          };
        });

        return nextTabId;
      },

      openTabWithDraft: (draft) => {
        let nextTabId = "";

        set((state) => {
          const nextDraft = touchDraft(buildDraft(state.tabs.length + 1), {
            items: draft.items,
            selectedPriceTier: draft.selectedPriceTier ?? "normal",
            paymentMethod: draft.paymentMethod ?? null,
            notes: draft.notes ?? "",
            amountReceived: draft.amountReceived ?? "",
            isProcessing: false,
          });
          const nextTabs = relabelDrafts([...state.tabs, nextDraft]);
          nextTabId = nextDraft.id;

          return {
            tabs: nextTabs,
            activeTabId: nextDraft.id,
            nextTabNumber: nextTabs.length + 1,
          };
        });

        return nextTabId;
      },

      closeTab: (tabId: string) => {
        set((state) => {
          const currentIndex = state.tabs.findIndex((tab) => tab.id === tabId);
          if (currentIndex < 0) return state;

          if (state.tabs.length === 1) {
            return state;
          }

          const nextTabs = relabelDrafts(
            state.tabs.filter((tab) => tab.id !== tabId)
          );
          const fallbackIndex = Math.max(0, currentIndex - 1);
          const nextActiveTabId =
            state.activeTabId === tabId
              ? (nextTabs[fallbackIndex]?.id ?? nextTabs[0].id)
              : state.activeTabId;

          return {
            tabs: nextTabs,
            activeTabId: nextActiveTabId,
            nextTabNumber: nextTabs.length + 1,
          };
        });
      },

      setActiveTab: (tabId: string) => {
        set((state) => {
          if (!state.tabs.some((tab) => tab.id === tabId)) {
            return state;
          }

          return { activeTabId: tabId };
        });
      },

      addItem: (product: ProductWithOwner, tierOverride?: SelectablePriceTier) => {
        const activeDraft = getActiveDraft(get());
        if (!activeDraft) {
          return { ok: false, reason: "not_found" };
        }

        const selectedTier = tierOverride ?? activeDraft.selectedPriceTier;
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
          const currentDraft = getActiveDraft(state);
          if (!currentDraft) return state;

          const existingIndex = currentDraft.items.findIndex(
            (item) => item.product_id === product.id
          );

          const nextItems = [...currentDraft.items];

          if (existingIndex >= 0) {
            const existingItem = { ...nextItems[existingIndex] };
            existingItem.quantity += 1;
            existingItem.available_stock = product.stock;
            existingItem.subtotal = existingItem.quantity * existingItem.price_override;
            nextItems[existingIndex] = existingItem;

            result = {
              ok: true,
              availableStock: product.stock,
              appliedPrice: existingItem.price_override,
              appliedTier: existingItem.price_tier,
            };
          } else {
            const newItem: CartItem = {
              id: buildId(),
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

            nextItems.push(newItem);
          }

          const mapped = mapTabs(state.tabs, currentDraft.id, (draft) =>
            touchDraft(draft, { items: nextItems })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });

        return result;
      },

      removeItem: (itemId: string) => {
        set((state) => {
          const activeDraft = getActiveDraft(state);
          if (!activeDraft) return state;

          const mapped = mapTabs(state.tabs, activeDraft.id, (draft) =>
            touchDraft(draft, {
              items: draft.items.filter((item) => item.id !== itemId),
            })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });
      },

      updateQuantity: (itemId: string, quantity: number) => {
        if (quantity <= 0) {
          get().removeItem(itemId);
          return { ok: true };
        }

        const activeDraft = getActiveDraft(get());
        const existingItem = activeDraft?.items.find((item) => item.id === itemId);

        if (!activeDraft || !existingItem) {
          return { ok: false, reason: "not_found" };
        }

        set((state) => {
          const currentDraft = getActiveDraft(state);
          if (!currentDraft) return state;

          const mapped = mapTabs(state.tabs, currentDraft.id, (draft) =>
            touchDraft(draft, {
              items: draft.items.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      quantity,
                      subtotal: quantity * item.price_override,
                    }
                  : item
              ),
            })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });

        return { ok: true, availableStock: existingItem.available_stock };
      },

      updatePrice: (itemId: string, newPrice: number) => {
        set((state) => {
          const activeDraft = getActiveDraft(state);
          if (!activeDraft) return state;

          const mapped = mapTabs(state.tabs, activeDraft.id, (draft) =>
            touchDraft(draft, {
              items: draft.items.map((item) =>
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
            })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });
      },

      updatePriceTier: (itemId: string, tier: SelectablePriceTier) => {
        const activeDraft = getActiveDraft(get());
        const existingItem = activeDraft?.items.find((item) => item.id === itemId);

        if (!activeDraft || !existingItem) {
          return { ok: false, reason: "not_found" };
        }

        const nextPrice = getTabTierPrice(existingItem, tier);
        if (nextPrice === null || nextPrice === undefined || nextPrice <= 0) {
          return {
            ok: false,
            reason: "price_tier_unavailable",
            availableStock: existingItem.available_stock,
            appliedTier: tier,
          };
        }

        set((state) => {
          const currentDraft = getActiveDraft(state);
          if (!currentDraft) return state;

          const mapped = mapTabs(state.tabs, currentDraft.id, (draft) =>
            touchDraft(draft, {
              items: draft.items.map((item) =>
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
            })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });

        return {
          ok: true,
          availableStock: existingItem.available_stock,
          appliedPrice: nextPrice,
          appliedTier: tier,
        };
      },

      setSelectedPriceTier: (tier: SelectablePriceTier) => {
        set((state) => {
          const activeDraft = getActiveDraft(state);
          if (!activeDraft) return state;

          const mapped = mapTabs(state.tabs, activeDraft.id, (draft) =>
            touchDraft(draft, { selectedPriceTier: tier })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });
      },

      setPaymentMethod: (method: PaymentMethod | null) => {
        set((state) => {
          const activeDraft = getActiveDraft(state);
          if (!activeDraft) return state;

          const mapped = mapTabs(state.tabs, activeDraft.id, (draft) =>
            touchDraft(draft, { paymentMethod: method })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });
      },

      clearCart: () => {
        set((state) => {
          const activeDraft = getActiveDraft(state);
          if (!activeDraft) return state;

          const mapped = mapTabs(state.tabs, activeDraft.id, (draft) =>
            touchDraft(draft, {
              items: [],
              selectedPriceTier: "normal",
              paymentMethod: null,
              isProcessing: false,
              notes: "",
              amountReceived: "",
            })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });
      },

      setProcessing: (value: boolean) => {
        set((state) => {
          const activeDraft = getActiveDraft(state);
          if (!activeDraft) return state;

          const mapped = mapTabs(state.tabs, activeDraft.id, (draft) =>
            touchDraft(draft, { isProcessing: value })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });
      },

      setNotes: (notes: string) => {
        set((state) => {
          const activeDraft = getActiveDraft(state);
          if (!activeDraft) return state;

          const mapped = mapTabs(state.tabs, activeDraft.id, (draft) =>
            touchDraft(draft, { notes })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });
      },

      setAmountReceived: (amount: string) => {
        set((state) => {
          const activeDraft = getActiveDraft(state);
          if (!activeDraft) return state;

          const mapped = mapTabs(state.tabs, activeDraft.id, (draft) =>
            touchDraft(draft, { amountReceived: amount })
          );

          if (!mapped.found) return state;

          return {
            tabs: mapped.tabs,
          };
        });
      },

      getTotal: () => {
        const activeDraft = getActiveDraft(get());
        return activeDraft?.items.reduce((sum, item) => sum + item.subtotal, 0) ?? 0;
      },

      getItemCount: () => {
        const activeDraft = getActiveDraft(get());
        return (
          activeDraft?.items.reduce((count, item) => count + item.quantity, 0) ?? 0
        );
      },

      getPartnerSummaries: () => {
        const activeDraft = getActiveDraft(get());
        const items = activeDraft?.items ?? [];
        const summaryMap = new Map<string, PartnerSaleSummary>();

        for (const item of items) {
          const existing = summaryMap.get(item.owner_id);
          if (existing) {
            existing.total += item.subtotal;
            existing.item_count += item.quantity;
            continue;
          }

          summaryMap.set(item.owner_id, {
            partner_id: item.owner_id,
            partner_name: item.owner_name,
            display_name: item.owner_display_name,
            color_hex: item.owner_color,
            total: item.subtotal,
            item_count: item.quantity,
          });
        }

        return Array.from(summaryMap.values());
      },
    }),
    {
      name: POS_CART_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        tabs: state.tabs.map((tab) => ({
          ...tab,
          isProcessing: false,
        })),
        activeTabId: state.activeTabId,
        nextTabNumber: state.nextTabNumber,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...ensureStoreShape(persistedState as Partial<CartStoreState>),
      }),
    }
  )
);

export function useCart() {
  const tabs = useCartStore((state) => state.tabs);
  const activeTabId = useCartStore((state) => state.activeTabId);
  const nextTabNumber = useCartStore((state) => state.nextTabNumber);
  const openTab = useCartStore((state) => state.openTab);
  const openTabWithDraft = useCartStore((state) => state.openTabWithDraft);
  const closeTab = useCartStore((state) => state.closeTab);
  const setActiveTab = useCartStore((state) => state.setActiveTab);
  const addItem = useCartStore((state) => state.addItem);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const updatePrice = useCartStore((state) => state.updatePrice);
  const updatePriceTier = useCartStore((state) => state.updatePriceTier);
  const setSelectedPriceTier = useCartStore(
    (state) => state.setSelectedPriceTier
  );
  const setPaymentMethod = useCartStore((state) => state.setPaymentMethod);
  const clearCart = useCartStore((state) => state.clearCart);
  const setProcessing = useCartStore((state) => state.setProcessing);
  const getTotal = useCartStore((state) => state.getTotal);
  const getItemCount = useCartStore((state) => state.getItemCount);
  const getPartnerSummaries = useCartStore((state) => state.getPartnerSummaries);
  const setNotes = useCartStore((state) => state.setNotes);
  const setAmountReceived = useCartStore((state) => state.setAmountReceived);

  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ??
    tabs[0] ??
    createInitialCartState().tabs[0];

  return {
    tabs,
    activeTabId,
    activeTab,
    nextTabNumber,
    items: activeTab.items,
    selectedPriceTier: activeTab.selectedPriceTier,
    paymentMethod: activeTab.paymentMethod,
    isProcessing: activeTab.isProcessing,
    notes: activeTab.notes,
    amountReceived: activeTab.amountReceived,
    openTab,
    openTabWithDraft,
    closeTab,
    setActiveTab,
    addItem,
    removeItem,
    updateQuantity,
    updatePrice,
    updatePriceTier,
    setSelectedPriceTier,
    setPaymentMethod,
    clearCart,
    setProcessing,
    getTotal,
    getItemCount,
    getPartnerSummaries,
    setNotes,
    setAmountReceived,
  };
}
