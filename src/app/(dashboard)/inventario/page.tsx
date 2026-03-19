/**
 * @file inventario/page.tsx
 * @description Página de gestión de inventario.
 *
 * LAYOUT:
 * - Header con título y botón "Nuevo Producto"
 * - Tabla de productos con búsqueda y filtros
 * - Modal de etiqueta de código de barras
 *
 * FEATURES:
 * - CRUD completo de productos
 * - Filtro por socia dueña y stock bajo
 * - Generación de etiquetas con código de barras
 * - Impresión de etiquetas individuales
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { Package } from "lucide-react";
import { ProductTable } from "@/components/inventory/product-table";
import { ProductForm } from "@/components/inventory/product-form";
import { BarcodeLabel } from "@/components/inventory/barcode-label";
import { getCatalogPartners } from "@/lib/local/catalog";
import type { Partner, ProductWithOwner } from "@/types/database";

export default function InventarioPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [labelProduct, setLabelProduct] = useState<ProductWithOwner | null>(
    null
  );

  // Cargar partners
  const fetchPartners = useCallback(async () => {
    try {
      const data = await getCatalogPartners();
      setPartners(data);
    } catch (err) {
      console.error("[InventarioPage] fetchPartners error:", err);
    }
  }, []);

  useEffect(() => {
    fetchPartners();
  }, [fetchPartners]);

  const handleProductSaved = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5 text-slate-700" />
            Inventario
          </h1>
          <p className="text-sm text-muted-foreground">
            Consulta rapido que hay disponible, que esta por agotarse y a quien
            pertenece cada prenda.
          </p>
        </div>

        <ProductForm partners={partners} onSaved={handleProductSaved} />
      </div>

      {/* Productos */}
      <div className="flex-1 min-h-0">
        <ProductTable
          partners={partners}
          refreshTrigger={refreshTrigger}
          onGenerateLabel={(product) => setLabelProduct(product)}
        />
      </div>

      {/* Modal de etiqueta */}
      <BarcodeLabel
        product={labelProduct}
        open={!!labelProduct}
        onClose={() => setLabelProduct(null)}
      />
    </div>
  );
}
