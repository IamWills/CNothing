"use client";

import * as React from "react";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import { fetchV4AuthMe } from "@/lib/api-v4";

export function useConsoleAuth() {
  const connectionState = useConsoleConnection();
  const sessionState = useUserSession();

  const refreshAuth = React.useCallback(async () => {
    try {
      const me = await fetchV4AuthMe(connectionState.connection);
      sessionState.syncSessionFromServer({
        userId: me.user_id,
        expiresAt: me.expires_at,
        role: me.role,
        email: me.email,
        displayName: me.display_name,
      });
      return me;
    } catch {
      return null;
    }
  }, [connectionState.connection, sessionState.syncSessionFromServer]);

  React.useEffect(() => {
    if (!connectionState.connection.baseUrl) return;
    void refreshAuth();
  }, [connectionState.connection.baseUrl, refreshAuth]);

  return {
    ...connectionState,
    ...sessionState,
    refreshAuth,
  };
}
