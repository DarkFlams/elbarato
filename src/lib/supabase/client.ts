import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (
    !url ||
    !key ||
    url === "your-supabase-url-here" ||
    key === "your-supabase-anon-key-here"
  ) {
    return {
      auth: {
        signInWithPassword: async () => ({
          error: {
            message:
              "Supabase no esta configurado. Agrega tus credenciales en .env.local",
          },
        }),
        signOut: async () => ({ error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
      rpc: async () => ({
        data: null,
        error: { message: "Supabase no configurado" },
      }),
      from: () => ({
        select: () => ({
          data: null,
          error: { message: "Supabase no configurado" },
        }),
        insert: () => ({
          data: null,
          error: { message: "Supabase no configurado" },
        }),
        update: () => ({
          data: null,
          error: { message: "Supabase no configurado" },
        }),
        delete: () => ({
          data: null,
          error: { message: "Supabase no configurado" },
        }),
      }),
    } as unknown as ReturnType<typeof createBrowserClient>;
  }

  client = createBrowserClient(url, key);
  return client;
}
