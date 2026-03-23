"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCart } from "@/hooks/use-cart";
import { cn } from "@/lib/utils";

function getDraftItemCount(items: { quantity: number }[]) {
  return items.reduce((total, item) => total + item.quantity, 0);
}

export function PosTabs() {
  const { tabs, activeTabId, openTab, closeTab, setActiveTab } = useCart();
  const canCloseTabs = tabs.length > 1;
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [animatedTabId, setAnimatedTabId] = useState<string | null>(null);
  const animationTimeoutRef = useRef<number | null>(null);

  const pendingCloseTab = useMemo(
    () => tabs.find((tab) => tab.id === pendingCloseTabId) ?? null,
    [pendingCloseTabId, tabs]
  );

  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current !== null) {
        window.clearTimeout(animationTimeoutRef.current);
      }
    };
  }, []);

  const triggerTabAnimation = (tabId: string) => {
    setAnimatedTabId(tabId);

    if (animationTimeoutRef.current !== null) {
      window.clearTimeout(animationTimeoutRef.current);
    }

    animationTimeoutRef.current = window.setTimeout(() => {
      setAnimatedTabId(null);
      animationTimeoutRef.current = null;
    }, 220);
  };

  const handleClose = (
    event: React.MouseEvent<HTMLButtonElement>,
    tabId: string
  ) => {
    event.stopPropagation();
    if (!canCloseTabs) return;

    const draft = tabs.find((tab) => tab.id === tabId);
    if (!draft) return;

    const hasPendingContent =
      draft.items.length > 0 ||
      Boolean(draft.notes.trim()) ||
      Boolean(draft.amountReceived.trim()) ||
      draft.paymentMethod !== null;

    if (hasPendingContent) {
      setPendingCloseTabId(tabId);
      return;
    }

    closeTab(tabId);
  };

  const confirmCloseTab = () => {
    if (!pendingCloseTab) return;
    closeTab(pendingCloseTab.id);
    setPendingCloseTabId(null);
  };

  return (
    <>
      <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-sm">
        <div className="flex w-full items-center gap-1 overflow-x-auto pb-0.5">
          {tabs.map((tab) => {
            const itemCount = getDraftItemCount(tab.items);
            const isActive = tab.id === activeTabId;
            const isAnimating = animatedTabId === tab.id;

            return (
              <div
                key={tab.id}
                className={cn(
                  "group flex h-8 shrink-0 items-center gap-0.5 rounded-md border text-xs transition-[transform,colors,box-shadow] duration-200",
                  isActive
                    ? "border-slate-300 bg-slate-100 text-slate-800 shadow-sm"
                    : "border-transparent bg-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700"
                    ,
                  isAnimating && "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-200"
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    triggerTabAnimation(tab.id);
                    setActiveTab(tab.id);
                  }}
                  className={cn(
                    "flex h-full items-center gap-1.5 px-2.5 transition-transform duration-200",
                    isActive && "translate-y-[-1px]"
                  )}
                >
                  <span className="font-medium">{tab.label}</span>
                  {itemCount > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1 py-0 text-[9px] font-semibold tabular-nums",
                        isActive
                          ? "bg-slate-200 text-slate-600"
                          : "bg-slate-100 text-slate-500"
                      )}
                    >
                      {itemCount}
                    </span>
                  )}
                </button>
                {canCloseTabs ? (
                  <button
                    type="button"
                    onClick={(event) => handleClose(event, tab.id)}
                    className={cn(
                      "mr-0.5 flex h-4.5 w-4.5 items-center justify-center rounded transition-colors",
                      isActive
                        ? "text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        : "text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                    )}
                    title={`Cerrar ${tab.label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            );
          })}

          <Button
            type="button"
            onClick={() => {
              const nextTabId = openTab();
              triggerTabAnimation(nextTabId);
            }}
            variant="ghost"
            size="icon"
            title="Nueva venta"
            className="h-8 w-8 shrink-0 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Dialog
        open={Boolean(pendingCloseTab)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCloseTabId(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="border-slate-200 bg-white p-0 shadow-2xl sm:max-w-[420px]"
        >
          <div className="p-5">
            <DialogHeader className="gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <DialogTitle className="text-[15px] font-semibold text-slate-900">
                    Cerrar {pendingCloseTab?.label}
                  </DialogTitle>
                  <DialogDescription className="text-sm leading-relaxed text-slate-500">
                    Esta venta tiene informacion pendiente. Si la cierras, se perdera su contenido.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <DialogFooter className="border-slate-100 bg-slate-50/80">
            <Button
              type="button"
              variant="outline"
              className="border-slate-200 text-slate-600"
              onClick={() => setPendingCloseTabId(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-slate-900 text-white hover:bg-slate-800"
              onClick={confirmCloseTab}
            >
              Cerrar venta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
