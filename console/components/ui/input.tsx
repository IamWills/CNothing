import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-[var(--radius-control)] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/80 px-3 text-sm outline-none transition-[border-color,background-color] focus-visible:border-[color:var(--brand)] focus-visible:bg-white",
        className,
      )}
      {...props}
    />
  );
}
