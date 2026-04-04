import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[999px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/80 px-2 py-0.5 text-xs",
        className,
      )}
      {...props}
    />
  );
}
