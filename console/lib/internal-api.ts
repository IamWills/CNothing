import type { V4AuthProvider } from "@/lib/api-v4";

/** Loopback API. Never use KEYSERVICE_PUBLIC_URL here — that hairpins through Cloudflare. */
export function internalApiOrigin() {
  return (process.env.KEYSERVICE_INTERNAL_API_URL || "http://127.0.0.1:3021").replace(/\/+$/, "");
}

export async function loadLoginProviders(): Promise<V4AuthProvider[]> {
  try {
    const response = await fetch(`${internalApiOrigin()}/v4/auth/providers`, { cache: "no-store" });
    if (!response.ok) return [];
    const data = (await response.json()) as { items?: V4AuthProvider[] };
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}
