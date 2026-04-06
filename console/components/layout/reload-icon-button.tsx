"use client";

import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReloadIconButton({
  onReload,
  disabled,
}: {
  onReload?: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label="Reload page"
      title="Reload page"
      disabled={disabled}
      onClick={() => {
        if (onReload) {
          onReload();
          return;
        }

        window.location.reload();
      }}
      className="rounded-full bg-white/14 text-white hover:bg-white/22"
    >
      <RefreshCcw className="h-4 w-4" />
    </Button>
  );
}
