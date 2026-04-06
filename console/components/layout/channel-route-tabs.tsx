"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ChannelTab } from "@/lib/channel-tabs";

export function ChannelRouteTabs({
  items,
  className,
}: {
  items: ChannelTab[];
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex w-fit flex-wrap items-center gap-1 self-end rounded-[var(--radius-tab-nav)] border border-white/20 bg-white/10 p-1 backdrop-blur-sm",
        className,
      )}
    >
      {items.map((item) => {
        const matches = item.activePrefixes ?? [item.href];
        const isActive = matches.some((prefix) =>
          item.match === "exact" || prefix === "/"
            ? pathname === prefix
            : pathname === prefix || pathname.startsWith(`${prefix}/`),
        );

        return (
          <a
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex h-9 items-center justify-center rounded-[var(--radius-tab-item)] px-3 text-sm font-medium transition-colors",
              isActive
                ? "bg-white text-slate-950"
                : "text-white/78 hover:bg-white/10 hover:text-white",
            )}
          >
            {item.label}
          </a>
        );
      })}
    </div>
  );
}
