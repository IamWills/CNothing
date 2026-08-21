"use client";

import * as React from "react";

const STORAGE_KEY = "cnothing-user-session";

export type UserRole = "user" | "admin";

type StoredUserSession = {
  sessionToken: string;
  userId: string;
  expiresAt: string;
  email?: string | null;
  displayName?: string | null;
};

type SyncSessionInput = {
  userId: string;
  expiresAt: string;
  sessionToken?: string;
  role?: UserRole;
  email?: string | null;
  displayName?: string | null;
};

export function useUserSession() {
  const [session, setSession] = React.useState<StoredUserSession | null>(null);
  const [role, setRole] = React.useState<UserRole | null>(null);

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

  const saveSession = React.useCallback((next: StoredUserSession) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const syncSessionFromServer = React.useCallback((input: SyncSessionInput) => {
    saveSession({
      userId: input.userId,
      expiresAt: input.expiresAt,
      sessionToken: input.sessionToken ?? "cookie",
      email: input.email ?? null,
      displayName: input.displayName ?? null,
    });
    if (input.role) {
      setRole(input.role);
    }
  }, [saveSession]);

  const clearSession = React.useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setRole(null);
  }, []);

  return {
    session,
    role,
    saveSession,
    syncSessionFromServer,
    clearSession,
    isLoggedIn: Boolean(session?.userId),
    isAdmin: role === "admin",
  };
}

export function sessionAccountLabel(session: StoredUserSession | null): string {
  if (!session) return "";
  const name = session.displayName?.trim();
  const email = session.email?.trim();
  if (name && email && name !== email) {
    return `${name} · ${email}`;
  }
  return email || name || session.userId;
}

export type { StoredUserSession };
