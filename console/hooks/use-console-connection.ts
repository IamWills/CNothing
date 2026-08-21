"use client";

import * as React from "react";
import type { ConsoleConnection } from "@/lib/api";
import { sameOriginConnection } from "@/lib/api";

const STORAGE_KEY = "keyservice-console-settings";

function sameOriginBaseUrl(): string {
  return window.location.origin;
}

/** Drop leftover Admin Token and any cross-origin API URL from older consoles. */
function sanitizeStoredConnection(): ConsoleConnection {
  const origin = sameOriginBaseUrl();
  window.localStorage.removeItem("cnothing-admin-token");
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const next = { baseUrl: origin };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  try {
    JSON.parse(stored) as { baseUrl?: string; adminToken?: string };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    const next = { baseUrl: origin };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  const next = { baseUrl: origin };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function useConsoleConnection() {
  const initial = sameOriginConnection();
  const [connection, setConnection] = React.useState<ConsoleConnection>(initial);
  const [draft, setDraft] = React.useState({ baseUrl: initial.baseUrl });

  React.useEffect(() => {
    const next = sanitizeStoredConnection();
    setConnection(next);
    setDraft(next);
  }, []);

  function saveDraft() {
    const next = { baseUrl: sameOriginBaseUrl() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setConnection(next);
    setDraft(next);
  }

  return {
    connection,
    draft,
    setDraft,
    saveDraft,
  };
}
