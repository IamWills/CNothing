import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-view)] border border-[color:var(--border)] bg-[color:var(--surface)]/92 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.06)] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
