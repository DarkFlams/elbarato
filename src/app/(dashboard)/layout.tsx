"use client";

import { useEffect, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  ShoppingBag,
  ScanBarcode,
  Wallet,
  Package,
  ArrowUpDown,
  Database,
  BarChart3,
  CloudOff,
  CloudDownload,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Printer,
} from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { OfflineSyncIndicator } from "@/components/offline/offline-sync-indicator";
import { LocalCatalogGate } from "@/components/offline/local-catalog-gate";
import { isAuthBypassEnabled } from "@/lib/auth-mode";

const navigation = [
  {
    label: "Operaciones",
    items: [
      { title: "Punto de Venta", href: "/caja", icon: ScanBarcode },
      { title: "Ventas", href: "/ventas", icon: ShoppingBag },
      { title: "Gastos", href: "/gastos", icon: Wallet },
      { title: "Offline", href: "/offline", icon: CloudOff },
    ],
  },
  {
    label: "Gestion",
    items: [
      { title: "Inventario", href: "/inventario", icon: Package },
      { title: "Altas y Bajas", href: "/inventario/movimientos", icon: ArrowUpDown },
      { title: "Migracion", href: "/inventario/migracion", icon: Database },
      { title: "Reportes", href: "/reportes", icon: BarChart3 },
      { title: "Impresion", href: "/impresion", icon: Printer },
      { title: "Actualizaciones", href: "/actualizaciones", icon: CloudDownload },
    ],
  },
];

function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { state, toggleSidebar } = useSidebar();
  const bypassAuth = isAuthBypassEnabled();

  const handleLogout = async () => {
    if (bypassAuth) {
      router.push("/caja");
      router.refresh();
      return;
    }

    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const handleNavigate = (href: string) => {
    if (pathname === href) return;
    router.push(href);
  };

  return (
    <Sidebar collapsible="icon" className="relative border-r border-sidebar-border">
      <Button
        onClick={toggleSidebar}
        variant="outline"
        size="icon"
        className="absolute -right-3 top-1/2 z-50 flex h-[22px] w-[22px] -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-md transition-transform hover:scale-110 hover:text-indigo-600 focus:outline-none"
      >
        {state === "expanded" ? (
          <ChevronLeft className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span className="sr-only">Toggle Sidebar</span>
      </Button>

      <SidebarHeader className="p-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-md shadow-indigo-600/20">
            <ShoppingBag className="h-4.5 w-4.5 text-white" />
          </div>
          <div className="flex flex-col flex-1 group-data-[collapsible=icon]:hidden overflow-hidden">
            <span className="gradient-text truncate text-[13px] font-semibold">{APP_NAME}</span>
            <span className="truncate text-[10px] text-muted-foreground">Control de Ventas</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {navigation.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        type="button"
                        onClick={() => handleNavigate(item.href)}
                        isActive={isActive}
                        tooltip={item.title}
                        className="transition-all duration-200"
                      >
                        <item.icon className="h-3.5 w-3.5" />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-1.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              tooltip="Cerrar sesion"
              className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Cerrar Sesion</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function DashboardAuthGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  const bypassAuth = isAuthBypassEnabled();
  const [status, setStatus] = useState<"checking" | "allowed">(
    bypassAuth ? "allowed" : "checking"
  );

  useEffect(() => {
    if (bypassAuth) {
      setStatus("allowed");
      return;
    }

    let mounted = true;

    const verifySession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (session) {
        setStatus("allowed");
        return;
      }

      router.replace("/login");
    };

    void verifySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!mounted) return;

      if (session) {
        setStatus("allowed");
        return;
      }

      setStatus("checking");
      router.replace("/login");
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [bypassAuth, router, supabase]);

  if (status === "allowed") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
        <span className="text-sm font-medium text-slate-700">
          Verificando sesion de Supabase...
        </span>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <main className="flex h-screen flex-col overflow-hidden p-2.5 lg:p-3 2xl:p-4">
          <DashboardAuthGate>
            <OfflineSyncIndicator />
            <LocalCatalogGate>{children}</LocalCatalogGate>
          </DashboardAuthGate>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

