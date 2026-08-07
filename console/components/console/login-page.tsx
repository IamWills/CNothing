"use client";

import * as React from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { PageFrame } from "@/components/layout/page-frame";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import {
  buildV4AuthProviderStartUrl,
  fetchV4AuthMe,
  fetchV4AuthProviders,
  logoutV4User,
  type V4AuthProvider,
} from "@/lib/api-v4";

export function LoginPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { session, syncSessionFromServer, clearSession, isLoggedIn } = useUserSession();
  const [providers, setProviders] = React.useState<V4AuthProvider[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");

  React.useEffect(() => {
    void Promise.all([fetchV4AuthMe(connection), fetchV4AuthProviders(connection)])
      .then(([me, available]) => {
        syncSessionFromServer({ userId: me.user_id, expiresAt: me.expires_at });
        setProviders(available.items);
        setStatusMessage(`Signed in as ${me.user_id}.`);
      })
      .catch(() => {
        void fetchV4AuthProviders(connection)
          .then((available) => setProviders(available.items))
          .catch((error) => setErrorMessage(error instanceof Error ? error.message : "Unable to load sign-in providers."));
      });
  }, [connection, syncSessionFromServer]);

  async function logout() {
    setErrorMessage("");
    try {
      await logoutV4User(connection);
      clearSession();
      setStatusMessage("Signed out.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Sign out failed.");
    }
  }

  return (
    <PageFrame
      title="User Sign In"
      description="Sign in through a configured identity provider. OAuth credentials remain in CNothing."
    >
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Sign in</h2>
          </div>
          <p className="text-sm text-slate-600">
            Authentication opens in your browser. Never send passwords, personal access tokens, or cookies to an agent.
          </p>
          <div className="flex flex-wrap gap-2">
            {providers.map((provider) => (
              <Button
                key={`${provider.type}:${provider.name}`}
                type="button"
                variant="secondary"
                onClick={() => {
                  const redirectAfter = `${window.location.origin}/login`;
                  window.location.href = buildV4AuthProviderStartUrl(connection, provider, redirectAfter);
                }}
              >
                Continue with {provider.display_name}
              </Button>
            ))}
          </div>
          {providers.length === 0 ? (
            <p className="text-sm text-amber-700">No identity provider is configured. Ask the operator to configure GitHub or OIDC.</p>
          ) : null}
        </Card>

        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Current session</h2>
          </div>
          {isLoggedIn && session ? (
            <>
              <p className="text-sm">Signed in as <strong>{session.userId}</strong></p>
              <p className="text-sm text-slate-600">Expires: {session.expiresAt}</p>
              <Button variant="secondary" onClick={() => void logout()}>Sign out</Button>
            </>
          ) : (
            <p className="text-sm text-slate-600">Not signed in.</p>
          )}
        </Card>
      </div>
    </PageFrame>
  );
}
