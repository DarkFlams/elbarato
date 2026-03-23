"use client";

import { useCallback, useEffect, useState } from "react";
import { Tags } from "lucide-react";
import Link from "next/link";
import { PriceListTable } from "@/components/pricing/price-list-table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCatalogPartners } from "@/lib/local/catalog";
import type { Partner } from "@/types/database";

export default function PreciosPage() {
  const [partners, setPartners] = useState<Partner[]>([]);

  const fetchPartners = useCallback(async () => {
    try {
      const data = await getCatalogPartners();
      setPartners(data);
    } catch (error) {
      console.error("[PreciosPage] fetchPartners error:", error);
    }
  }, []);

  useEffect(() => {
    void fetchPartners();
  }, [fetchPartners]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Tags className="h-5 w-5 text-slate-700" />
            Lista de Precios
          </h1>
          <p className="text-sm text-muted-foreground">
            Consulta y edita rapido los precios normal, x3, x6 y x12 por producto.
          </p>
        </div>

        <Link
          href="/precios/importar"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "border-slate-200 bg-white shadow-sm"
          )}
        >
          Importar Excel
        </Link>
      </div>

      <div className="min-h-0 flex-1">
        <PriceListTable
          partners={partners}
          refreshTrigger={0}
        />
      </div>
    </div>
  );
}
