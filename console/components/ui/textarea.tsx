import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full rounded-[var(--radius-textarea)] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/80 px-4 py-3 text-sm outline-none transition-[border-color,background-color] focus-visible:border-[color:var(--brand)] focus-visible:bg-white",
        className,
      )}
      {...props}
    />
  );
}
