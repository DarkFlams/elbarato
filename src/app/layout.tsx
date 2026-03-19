import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "POS Tienda de Ropa",
  description: "Sistema de Punto de Venta y Control de Gastos",
  manifest: "/manifest.json",
  themeColor: "#4f46e5",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "POS Ropa",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              const isTauriRuntime =
                navigator.userAgent.includes('Tauri') ||
                '__TAURI_INTERNALS__' in window;

              if ('serviceWorker' in navigator) {
                window.addEventListener('load', async () => {
                  if (isTauriRuntime) {
                    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
                    await Promise.all(registrations.map((registration) => registration.unregister()));
                    return;
                  }

                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
        <Toaster
          position="top-right"
          richColors
          theme="light"
          toastOptions={{
            className: "bg-white border-slate-200 shadow-md",
          }}
        />
      </body>
    </html>
  );
}
