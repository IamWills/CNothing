"use client";

import type { ComponentType } from "react";
import { usePathname } from "next/navigation";
import { ExternalLink, Github, LayoutGrid, LogIn, Shield, Smartphone } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { Badge } from "@/components/ui/badge";
import { useConsoleAuth } from "@/hooks/use-console-auth";
import { sessionAccountLabel } from "@/hooks/use-user-session";
import { brand } from "@/lib/brand";

const userNavigation: Array<{
  href: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  matches: string[];
  adminOnly?: boolean;
}> = [
  { href: "/", label: "Home", matches: ["/", "/readme"] },
  {
    href: "/login",
    label: "Sign in",
    icon: LogIn,
    matches: ["/login"],
  },
  {
    href: "/devices",
    label: "Devices",
    icon: Smartphone,
    matches: ["/devices"],
  },
  {
    href: "/connect",
    label: "Console",
    icon: LayoutGrid,
    matches: ["/connect", "/connections", "/grants", "/approve-proxy"],
  },
  {
    href: "/agents",
    label: "Agents",
    icon: Shield,
    matches: ["/agents"],
    adminOnly: true,
  },
  {
    href: "/providers",
    label: "Providers",
    icon: Shield,
    matches: ["/providers"],
    adminOnly: true,
  },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { isLoggedIn, isAdmin, session } = useConsoleAuth();

  const navigation = userNavigation.filter((item) => {
    if (item.href === "/login" && isLoggedIn) {
      return true;
    }
    return !item.adminOnly || isAdmin;
  });

  return (
    <header className="border-b border-[color:var(--border)]/70 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <BrandMark />
              <div className="space-y-2">
                <Badge className="border-transparent bg-[color:var(--brand)] text-white">
                  {brand.name}
                </Badge>
                <p className="text-2xl font-semibold tracking-tight text-slate-950">
                  {brand.tagline}
                </p>
              </div>
            </div>
            <div>
              <p className="max-w-3xl text-sm text-slate-600">{brand.description}</p>
              <p className="mt-1 max-w-3xl text-xs text-slate-500">{brand.principles}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isLoggedIn && session ? (
              <span className="rounded-full border border-[color:var(--border)] bg-white px-4 py-2 text-sm text-slate-700">
                {sessionAccountLabel(session)}
                {isAdmin ? " · admin" : ""}
              </span>
            ) : null}
            <a
              href="https://github.com/IamWills/CNothing"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-white px-4 py-2 text-sm text-slate-700 transition hover:border-slate-400"
            >
              <Github className="h-4 w-4" />
              GitHub
              <ExternalLink className="h-4 w-4 text-slate-400" />
            </a>
          </div>
        </div>

        <nav className="flex flex-wrap gap-2">
          {navigation.map((item) => {
            const href = item.href === "/login" && isLoggedIn ? "/login" : item.href;
            const label = item.href === "/login" && isLoggedIn ? "Account" : item.label;
            const isActive = item.matches.some((prefix) =>
              prefix === "/"
                ? pathname === "/"
                : pathname === prefix || pathname.startsWith(`${prefix}/`),
            );
            const Icon = item.icon;

            return (
              <a
                key={item.href}
                href={href}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  isActive
                    ? "border-[color:var(--brand)] bg-[color:var(--brand)] text-white"
                    : "border-[color:var(--border)] bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                {Icon ? <Icon className="mr-2 inline h-4 w-4" /> : null}
                {label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
