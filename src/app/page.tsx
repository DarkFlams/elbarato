"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { isTauriRuntime } from "@/lib/tauri-runtime";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(isTauriRuntime() ? "/caja" : "/movil/stock");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
        <span className="text-sm font-medium text-slate-700">
          Abriendo aplicacion...
        </span>
      </div>
    </div>
  );
}
