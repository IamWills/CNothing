"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TabsValue = string;

interface TabsContextValue {
  baseId: string;
  value: TabsValue;
  onValueChange: (next: TabsValue) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const value = React.useContext(TabsContext);
  if (!value) {
    throw new Error("Tabs components must be used within <Tabs />");
  }
  return value;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (next: string) => void;
  children: React.ReactNode;
}) {
  const reactId = React.useId();
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue ?? "");
  const activeValue = value ?? uncontrolledValue;

  function handleValueChange(next: string) {
    onValueChange?.(next);
    if (value === undefined) {
      setUncontrolledValue(next);
    }
  }

  return (
    <TabsContext.Provider
      value={{
        baseId: `tabs-${reactId}`,
        value: activeValue,
        onValueChange: handleValueChange,
      }}
    >
      {children}
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex w-fit flex-wrap items-center gap-1 rounded-[var(--radius-tab-nav)] border border-[color:var(--border)] bg-[color:var(--surface)]/75 p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  value,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const { baseId, value: activeValue, onValueChange } = useTabsContext();
  const selected = activeValue === value;
  const tabId = `${baseId}-tab-${value}`;
  const panelId = `${baseId}-panel-${value}`;

  return (
    <button
      id={tabId}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      onClick={() => onValueChange(value)}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-[var(--radius-tab-item)] px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]/35",
        selected
          ? "bg-[color:var(--background)] text-[color:var(--foreground)]"
          : "text-[color:var(--foreground)]/70 hover:text-[color:var(--foreground)]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const { baseId, value: activeValue } = useTabsContext();
  if (activeValue !== value) {
    return null;
  }
  const tabId = `${baseId}-tab-${value}`;
  const panelId = `${baseId}-panel-${value}`;

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={tabId}
      className={cn("pt-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}
