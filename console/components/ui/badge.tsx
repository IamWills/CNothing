import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[999px] border px-2 py-0.5 text-xs",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[color:var(--system-blue)] text-white",
        secondary: "border-[color:var(--border)] bg-[color:var(--surface-muted)]/80",
        outline: "border-[color:var(--border)] bg-transparent",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
