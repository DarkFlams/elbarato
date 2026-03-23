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
  Smartphone,
  Tags,
  PanelLeft,
  PanelLeftClose,
} from "lucide-react";
import { APP_NAME } from "@/lib/constants";
import { OfflineSyncIndicator } from "@/components/offline/offline-sync-indicator";
import { LocalCatalogGate } from "@/components/offline/local-catalog-gate";
import { isAuthBypassEnabled } from "@/lib/auth-mode";
import { useCartStore } from "@/hooks/use-cart";

const navigation = [
  {
    label: "Caja",
    items: [
      { title: "Terminal POS", href: "/caja", icon: ScanBarcode },
      { title: "Historial de Tickets", href: "/ventas", icon: ShoppingBag },
      { title: "Gastos Diarios", href: "/gastos", icon: Wallet },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { title: "Inventario", href: "/inventario", icon: Package },
      { title: "Lista de Precios", href: "/precios", icon: Tags },
      { title: "Altas y Bajas", href: "/inventario/movimientos", icon: ArrowUpDown },
      { title: "Reportes", href: "/reportes", icon: BarChart3 },
    ],
  },
  {
    label: "Sistema",
    items: [
      { title: "Impresión", href: "/impresion", icon: Printer },
      { title: "Stock Móvil", href: "/stock-movil", icon: Smartphone },
      { title: "Modo Offline", href: "/offline", icon: CloudOff },
      { title: "Base de Datos", href: "/inventario/migracion", icon: Database },
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
  const openPosTab = useCartStore((store) => store.openTab);

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
    if (pathname === href) {
      if (href === "/caja") {
        openPosTab();
      }
      return;
    }

    router.push(href);
  };

  return (
    <Sidebar collapsible="icon" className="group/sidebar relative border-r border-slate-200 bg-white shadow-[4px_0_24px_-12px_rgba(0,0,0,0.06)]">
      <SidebarHeader className="p-3 group-data-[collapsible=icon]:p-2 border-b border-transparent transition-all">
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-slate-800 to-slate-930 shadow-md ring-1 ring-slate-900/10 transition-all">
            <span className="font-sans font-bold text-[16px] group-data-[collapsible=icon]:text-[14px] text-white tracking-tighter leading-none transition-all">D'</span>
          </div>
          <div className="flex flex-col flex-1 group-data-[collapsible=icon]:hidden overflow-hidden">
            <span className="truncate text-[14px] font-extrabold text-slate-900 tracking-tight leading-tight">
              D'Lorens & El Barato
            </span>
            <span className="truncate text-[9px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">
              Administración
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 group-data-[collapsible=icon]:px-1.5 gap-0 overflow-y-auto hide-scrollbar pt-1">
        {navigation.map((group, index) => (
          <SidebarGroup key={group.label} className={index !== 0 ? "mt-3" : ""}>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.12em] text-slate-400/80 font-bold mb-1 px-2 group-data-[collapsible=icon]:hidden transition-all duration-200">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <SidebarMenuItem key={item.href} className="group-data-[collapsible=icon]:mb-0.5">
                      <SidebarMenuButton
                        type="button"
                        onClick={() => handleNavigate(item.href)}
                        isActive={isActive}
                        tooltip={item.title}
                        className={`transition-all duration-200 rounded-md group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center h-8 px-2.5 relative overflow-hidden ${
                          isActive 
                            ? "bg-indigo-50/80 text-indigo-700 font-semibold shadow-sm ring-1 ring-indigo-500/20" 
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium"
                        }`}
                      >
                        {isActive && <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-indigo-600 group-data-[collapsible=icon]:hidden" />}
                        <item.icon className={`shrink-0 transition-colors ${isActive ? 'text-indigo-600 h-[16px] w-[16px]' : 'text-slate-400 h-[16px] w-[16px] group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-4 group-hover:text-slate-600'}`} />
                        <span className="text-[12px] group-data-[collapsible=icon]:hidden transition-all duration-200 whitespace-nowrap overflow-hidden text-ellipsis w-full ml-1.5">{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-2 group-data-[collapsible=icon]:p-1.5 border-t border-slate-100 mt-1 mb-6 transition-all">
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={toggleSidebar}
              tooltip={state === "expanded" ? "Ocultar menú" : "Expandir menú"}
              className="text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all cursor-pointer rounded-md h-8 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center font-medium px-2.5"
            >
              {state === "expanded" ? (
                <PanelLeftClose className="h-[16px] w-[16px] shrink-0 transition-colors group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-4" />
              ) : (
                <PanelLeft className="h-[16px] w-[16px] shrink-0 transition-colors group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-4" />
              )}
              <span className="text-[12px] group-data-[collapsible=icon]:hidden whitespace-nowrap overflow-hidden text-ellipsis w-full ml-1.5">Ocultar Menú</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <div className="h-px w-full bg-slate-100 my-1 group-data-[collapsible=icon]:hidden" />
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              onClick={handleLogout}
              tooltip="Cerrar sesión"
              className="text-slate-500 hover:bg-rose-50 hover:text-rose-600 hover:ring-1 hover:ring-rose-500/20 transition-all cursor-pointer rounded-md h-8 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center font-medium px-2.5"
            >
              <LogOut className="h-[16px] w-[16px] shrink-0 transition-colors group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-4" />
              <span className="text-[12px] group-data-[collapsible=icon]:hidden whitespace-nowrap overflow-hidden text-ellipsis w-full ml-1.5">Cerrar Sesión</span>
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

  if (bypassAuth || status === "allowed") {
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
        <main className="flex h-screen min-h-0 flex-col overflow-hidden p-2.5 lg:p-3 2xl:p-4">
          <DashboardAuthGate>
            <OfflineSyncIndicator />
            <div className="flex min-h-0 flex-1 flex-col">
              <LocalCatalogGate>{children}</LocalCatalogGate>
            </div>
          </DashboardAuthGate>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

