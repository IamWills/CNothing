"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { brand } from "@/lib/brand";

const navigation: Array<{ href: Route; label: string }> = [
  { href: "/", label: "Home" },
  { href: "/catalog", label: "Catalog" },
  { href: "/clients", label: "Clients" },
  { href: "/kv", label: "KV" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-[color:var(--border)]/70 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Badge className="border-transparent bg-slate-900 text-white">
              {brand.name}
            </Badge>
            <div>
              <p className="text-2xl font-semibold tracking-tight text-slate-950">
                {brand.tagline}
              </p>
              <p className="max-w-3xl text-sm text-slate-600">
                {brand.description}
              </p>
            </div>
          </div>
        </div>

        <nav className="flex flex-wrap gap-2">
          {navigation.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === item.href
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-[color:var(--border)] bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
