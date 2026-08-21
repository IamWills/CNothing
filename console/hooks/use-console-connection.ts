"use client";

import * as React from "react";
import type { ConsoleConnection } from "@/lib/api";

const STORAGE_KEY = "keyservice-console-settings";

type StoredSettings = {
  baseUrl: string;
  adminToken?: string;
};

export function useConsoleConnection() {
  const initialBaseUrl =
    typeof window === "undefined" ? "" : window.location.origin;

  const [connection, setConnection] = React.useState<ConsoleConnection>({
    baseUrl: initialBaseUrl,
  });
  const [draft, setDraft] = React.useState({ baseUrl: initialBaseUrl });

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const sameOriginConnection = { baseUrl: window.location.origin };
      setConnection(sameOriginConnection);
      setDraft(sameOriginConnection);
      return;
    }

    try {
      const parsed = JSON.parse(stored) as StoredSettings;
      const nextConnection = { baseUrl: parsed.baseUrl || window.location.origin };
      // Drop any previously persisted service credential; it is not a Human login.
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection));
      setConnection(nextConnection);
      setDraft(nextConnection);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  function saveDraft() {
    const nextConnection = {
      baseUrl: draft.baseUrl.trim() || window.location.origin,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection));
    setConnection(nextConnection);
  }

  return {
    connection,
    draft,
    setDraft,
    saveDraft,
  };
}
