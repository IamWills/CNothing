"use client";

import * as React from "react";

const STORAGE_KEY = "cnothing-user-session";

type StoredUserSession = {
  sessionToken: string;
  userId: string;
  expiresAt: string;
};

export function useUserSession() {
  const [session, setSession] = React.useState<StoredUserSession | null>(null);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as StoredUserSession;
      if (parsed.expiresAt && parsed.expiresAt <= new Date().toISOString()) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
      }
      setSession(parsed);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  function saveSession(next: StoredUserSession) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }

  function clearSession() {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }

  return {
    session,
    saveSession,
    clearSession,
    isLoggedIn: Boolean(session?.sessionToken),
  };
}

export type { StoredUserSession };
