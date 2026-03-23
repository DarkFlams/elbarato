import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthBypassEnabled } from "@/lib/auth-mode";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const userAgent = request.headers.get("user-agent")?.toLowerCase() ?? "";
  const hasDesktopQuery = request.nextUrl.searchParams.get("desktop") === "1";
  const hasDesktopCookie = request.cookies.get("desktop_runtime")?.value === "1";
  const isDesktopRequest =
    userAgent.includes("tauri") || hasDesktopQuery || hasDesktopCookie;
  const isMobileToolPath =
    pathname === "/movil/stock" || pathname.startsWith("/movil/stock/");
  const isAllowedInfraPath =
    pathname.startsWith("/api/") ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js";

  // Persist desktop mode in dev sessions where user-agent may not expose "tauri".
  if (hasDesktopQuery && !hasDesktopCookie) {
    const response = NextResponse.next({ request });
    response.cookies.set("desktop_runtime", "1", {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
    });
    return response;
  }

  // En web publica solo se exponen herramientas rapidas (movil/stock).
  // El dashboard completo queda reservado para runtime desktop (Tauri).
  if (!isDesktopRequest && !isMobileToolPath && !isAllowedInfraPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/movil/stock";
    return NextResponse.redirect(url);
  }

  if (isAuthBypassEnabled()) {
    return NextResponse.next({ request });
  }

  // Skip auth check if Supabase is not configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (
    !supabaseUrl ||
    !supabaseKey ||
    supabaseUrl === "your-supabase-url-here" ||
    supabaseKey === "your-supabase-anon-key-here"
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — important for Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If no user and not on auth pages, redirect to login
  if (
    !user &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/movil/stock")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
