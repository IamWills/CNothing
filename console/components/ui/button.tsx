"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] text-sm font-medium whitespace-nowrap transition-transform disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]/35",
  {
    variants: {
      variant: {
        default:
          "bg-[color:var(--brand)] text-white shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] hover:opacity-95",
        secondary:
          "bg-[color:var(--surface)] text-[color:var(--foreground)] border border-[color:var(--border)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]",
        ghost: "bg-transparent text-[color:var(--foreground)] hover:bg-[color:var(--surface)]/80",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), "active:scale-[0.97]", className)}
      {...props}
    />
  );
}
