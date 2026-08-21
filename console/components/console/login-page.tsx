"use client";

import * as React from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { sessionAccountLabel, useUserSession } from "@/hooks/use-user-session";
import { sameOriginConnection } from "@/lib/api";
import {
  accountLabel,
  buildV4AuthProviderStartUrl,
  fetchV4AuthMe,
  fetchV4AuthProviders,
  logoutV4User,
  sessionFromMe,
  type V4AuthProvider,
} from "@/lib/api-v4";

export function LoginPage() {
  const { session, syncSessionFromServer, clearSession, isLoggedIn, role } = useUserSession();
  const [providers, setProviders] = React.useState<V4AuthProvider[]>([]);
  const [providersLoaded, setProvidersLoaded] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");

  React.useEffect(() => {
    const live = sameOriginConnection();
    void Promise.all([fetchV4AuthMe(live), fetchV4AuthProviders(live)])
      .then(([me, available]) => {
        syncSessionFromServer(sessionFromMe(me));
        setProviders(available.items);
        setProvidersLoaded(true);
        setStatusMessage(`Signed in as ${accountLabel({ userId: me.user_id, email: me.email, displayName: me.display_name })}${me.role === "admin" ? " (admin)" : ""}.`);
      })
      .catch(() => {
        void fetchV4AuthProviders(live)
          .then((available) => {
            setProviders(available.items);
            setProvidersLoaded(true);
          })
          .catch((error) => {
            setProvidersLoaded(true);
            setErrorMessage(error instanceof Error ? error.message : "Unable to load sign-in providers.");
          });
      });
  }, [syncSessionFromServer]);

  async function logout() {
    setErrorMessage("");
    try {
      await logoutV4User(sameOriginConnection());
      clearSession();
      setStatusMessage("Signed out.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Sign out failed.");
    }
  }

  return (
    <PageFrame
      title="User Sign In"
      description="Sign in through a configured identity provider. Administrators and members use this same login."
    >
      {statusMessage ? (
        <p className="rounded-[20px] bg-slate-50 px-4 py-3 text-sm text-slate-600">{statusMessage}</p>
      ) : null}
      {errorMessage ? (
        <p className="rounded-[20px] bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>
      ) : null}

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
                  const live = sameOriginConnection();
                  const redirectAfter = `${window.location.origin}/login`;
                  window.location.href = buildV4AuthProviderStartUrl(live, provider, redirectAfter);
                }}
              >
                Continue with {provider.display_name}
              </Button>
            ))}
          </div>
          {!providersLoaded ? (
            <p className="text-sm text-slate-500">Loading sign-in options…</p>
          ) : providers.length === 0 ? (
            <p className="text-sm text-amber-700">
              No identity provider is configured. Set KEYSERVICE_GITHUB_OAUTH_CLIENT_ID and
              KEYSERVICE_GITHUB_OAUTH_CLIENT_SECRET, or enable a login provider in the registry.
            </p>
          ) : null}
        </Card>

        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Current session</h2>
          </div>
          {isLoggedIn && session ? (
            <>
              <p className="text-sm">
                Signed in as <strong>{sessionAccountLabel(session)}</strong>
              </p>
              <p className="text-sm text-slate-600">Role: {role ?? "user"}</p>
              <p className="text-sm text-slate-600">Expires: {session.expiresAt}</p>
              <Button variant="secondary" onClick={() => void logout()}>
                Sign out
              </Button>
            </>
          ) : (
            <p className="text-sm text-slate-600">Not signed in.</p>
          )}
        </Card>
      </div>
    </PageFrame>
  );
}
