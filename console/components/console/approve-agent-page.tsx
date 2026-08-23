"use client";

import * as React from "react";
import { PageFrame } from "@/components/layout/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { sessionAccountLabel, useUserSession } from "@/hooks/use-user-session";
import {
  approveV4AgentEnrollment,
  buildV4AuthProviderStartUrl,
  denyV4AgentEnrollment,
  fetchV4AgentEnrollment,
  fetchV4AuthMe,
  fetchV4AuthProviders,
  sessionFromMe,
  type V4AgentEnrollment,
  type V4AuthProvider,
} from "@/lib/api-v4";

export function ApproveAgentPage({ enrollmentId }: { enrollmentId: string }) {
  const { connection } = useConsoleConnection();
  const { session, syncSessionFromServer, isLoggedIn } = useUserSession();
  const [authReady, setAuthReady] = React.useState(false);
  const [enrollment, setEnrollment] = React.useState<V4AgentEnrollment | null>(null);
  const [authProviders, setAuthProviders] = React.useState<V4AuthProvider[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");

  const returnTo = React.useMemo(() => {
    if (typeof window === "undefined") {
      return `/approve-agent/${enrollmentId}`;
    }
    return `${window.location.origin}/approve-agent/${enrollmentId}${window.location.search}`;
  }, [enrollmentId]);

  React.useEffect(() => {
    let cancelled = false;
    void fetchV4AuthMe(connection)
      .then((response) => {
        if (cancelled) return;
        syncSessionFromServer(sessionFromMe(response));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, syncSessionFromServer]);

  React.useEffect(() => {
    void fetchV4AuthProviders(connection)
      .then((response) => setAuthProviders(response.items))
      .catch(() => setAuthProviders([]));
  }, [connection]);

  React.useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    setLoading(true);
    setErrorMessage("");
    void fetchV4AgentEnrollment(connection, enrollmentId)
      .then((item) => {
        if (!cancelled) setEnrollment(item);
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to load enrollment.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, connection, enrollmentId]);

  async function handleApprove() {
    setErrorMessage("");
    try {
      const result = await approveV4AgentEnrollment(connection, enrollmentId);
      setEnrollment((prev) => (prev ? { ...prev, status: "approved", agent_id: result.agent_id } : prev));
      setStatusMessage(
        result.message ??
          "This runtime is now your CNothing agent. The credential was issued to the plugin and will not be shown here.",
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Approval failed.");
    }
  }

  async function handleDeny() {
    setErrorMessage("");
    try {
      await denyV4AgentEnrollment(connection, enrollmentId);
      setEnrollment((prev) => (prev ? { ...prev, status: "denied" } : prev));
      setStatusMessage("Agent enrollment denied.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Deny failed.");
    }
  }

  return (
    <PageFrame
      title="Approve Agent Runtime"
      description="Pair this plugin with your CNothing account. The agent token is delivered only to the plugin and is never shown in this page or in chat."
    >
      {!authReady || loading ? (
        <Card className="mb-4 p-5 text-sm text-slate-600">Loading enrollment…</Card>
      ) : null}

      {authReady && !isLoggedIn ? (
        <Card className="mb-4 space-y-4 border-amber-200 bg-amber-50/80 p-5">
          <div>
            <h3 className="font-semibold text-amber-950">Sign in required</h3>
            <p className="mt-2 text-sm text-amber-900/90">
              Sign in to confirm this plugin may act as your CNothing agent. After signing in you
              will return to this page.
            </p>
          </div>
          {authProviders.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {authProviders.map((provider) => (
                <a
                  key={`${provider.type}:${provider.name}`}
                  href={buildV4AuthProviderStartUrl(connection, provider, returnTo)}
                >
                  <Button type="button">{provider.display_name}</Button>
                </a>
              ))}
            </div>
          ) : (
            <a href={`/login?redirect_after=${encodeURIComponent(returnTo)}`}>
              <Button>Sign in</Button>
            </a>
          )}
        </Card>
      ) : null}

      {isLoggedIn && session?.userId ? (
        <Card className="mb-4 p-4 text-sm text-slate-600">
          Signed in as <span className="font-medium text-slate-900">{sessionAccountLabel(session)}</span>
        </Card>
      ) : null}

      {errorMessage ? (
        <Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}
      {statusMessage ? (
        <Card className="mb-4 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {statusMessage}
        </Card>
      ) : null}

      {enrollment ? (
        <Card className="mb-4 space-y-4 p-5">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{enrollment.client_name}</h3>
            <Badge>{enrollment.status}</Badge>
          </div>
          <p className="text-sm text-slate-600">
            Pairing code:{" "}
            <span className="font-mono text-base font-semibold tracking-widest text-slate-900">
              {enrollment.user_code}
            </span>
          </p>
          <p className="text-sm text-slate-600">
            Confirm this code matches the one shown by the plugin. CNothing will not display the
            agent token after you approve.
          </p>
          {enrollment.client_uri ? (
            <p className="text-sm text-slate-600">
              Client:{" "}
              <a className="text-[color:var(--brand)]" href={enrollment.client_uri}>
                {enrollment.client_uri}
              </a>
            </p>
          ) : null}
          <p className="text-xs text-slate-500">Expires {new Date(enrollment.expires_at).toLocaleString()}</p>
          {isLoggedIn && enrollment.status === "pending" ? (
            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={() => void handleApprove()}>
                Approve this runtime
              </Button>
              <Button type="button" variant="secondary" onClick={() => void handleDeny()}>
                Deny
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </PageFrame>
  );
}
