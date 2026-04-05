"use client";

import { usePathname } from "next/navigation";
import { ExternalLink, FileText, Github, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { brand } from "@/lib/brand";

const navigation: Array<{ href: string; label: string }> = [
  { href: "/", label: "Home" },
  { href: "/standard", label: "Standard" },
  { href: "/readme", label: "Readme" },
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
          <div className="flex flex-wrap items-center gap-2">
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
            const isActive =
              item.href === "/"
                ? pathname === item.href
                : pathname.startsWith(item.href);

            return (
              <a
                key={item.href}
                href={item.href}
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-[color:var(--border)] bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                {item.href === "/standard" ? <ShieldCheck className="mr-2 inline h-4 w-4" /> : null}
                {item.href === "/readme" ? <FileText className="mr-2 inline h-4 w-4" /> : null}
                {item.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
