"use client";

import Link from "next/link";
import { AlertCircle, BarChart3 } from "lucide-react";

export default function CierrePage() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Cierre de caja deshabilitado</h1>
        <p className="mt-2 text-sm text-slate-500">
          Este software ya no usa apertura/cierre manual de caja. La operacion es continua y
          automatica.
        </p>
        <div className="mt-5">
          <Link
            href="/reportes"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Ir a Reportes
          </Link>
        </div>
      </div>
    </div>
  );
}
