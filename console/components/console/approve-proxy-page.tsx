"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import {
  approveV4AccessRequest,
  buildV4GitHubStartUrl,
  denyV4AccessRequest,
  fetchV4AccessRequest,
  fetchV4AuthMe,
  fetchV4Connections,
  type V4AccessRequest,
  type V4OAuthConnection,
} from "@/lib/api-v4";

export function ApproveProxyPage({ accessRequestId }: { accessRequestId: string }) {
  const { connection } = useConsoleConnection();
  const { session, syncSessionFromServer, isLoggedIn } = useUserSession();
  const [authReady, setAuthReady] = React.useState(false);
  const [request, setRequest] = React.useState<V4AccessRequest | null>(null);
  const [connections, setConnections] = React.useState<V4OAuthConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");

  const returnTo = React.useMemo(() => {
    if (typeof window === "undefined") {
      return `/approve-proxy/${accessRequestId}`;
    }
    return `${window.location.origin}/approve-proxy/${accessRequestId}${window.location.search}`;
  }, [accessRequestId]);

  // Cookie is source of truth; localStorage alone is not enough after OAuth redirect.
  React.useEffect(() => {
    let cancelled = false;
    void fetchV4AuthMe(connection)
      .then((response) => {
        if (cancelled) return;
        syncSessionFromServer({
          userId: response.user_id,
          expiresAt: response.expires_at,
        });
      })
      .catch(() => {
        // Not signed in (or cookie missing) — keep local session if any.
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, syncSessionFromServer]);

  React.useEffect(() => {
    if (!authReady || !isLoggedIn) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage("");
    void Promise.all([
      fetchV4AccessRequest(connection, accessRequestId),
      fetchV4Connections(connection),
    ])
      .then(([accessRequest, connectionsResponse]) => {
        if (cancelled) return;
        setRequest(accessRequest);
        const active = connectionsResponse.items.filter((item) => item.status === "active");
        setConnections(active);
        const matching = active.filter((item) => item.provider_slug === accessRequest.provider);
        if (matching[0]) {
          setSelectedConnectionId(matching[0].id);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "Unable to load access request.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessRequestId, authReady, connection, isLoggedIn]);

  const matchingConnections = React.useMemo(
    () =>
      request
        ? connections.filter((item) => item.provider_slug === request.provider)
        : [],
    [connections, request],
  );

  async function handleApprove() {
    if (!selectedConnectionId) {
      setErrorMessage("Select an OAuth connection first.");
      return;
    }
    setErrorMessage("");
    try {
      const result = await approveV4AccessRequest(connection, accessRequestId, {
        connection_id: selectedConnectionId,
      });
      setRequest((prev) => (prev ? { ...prev, status: "approved" } : prev));
      setStatusMessage(
        `Proxy access granted (grant ${result.grant.id}). The agent can now call ${result.grant.allowed_hosts.join(", ")} without ever seeing tokens.`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Approval failed.");
    }
  }

  async function handleDeny() {
    setErrorMessage("");
    try {
      await denyV4AccessRequest(connection, accessRequestId);
      setRequest((prev) => (prev ? { ...prev, status: "denied" } : prev));
      setStatusMessage("Access request denied.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Deny failed.");
    }
  }

  return (
    <PageFrame
      title="Approve Proxy Access"
      description="Grant an agent connection-level API access. Tokens stay on CNothing and are never shown to the agent."
    >
      {!authReady || loading ? (
        <Card className="mb-4 p-5 text-sm text-slate-600">Loading approval request…</Card>
      ) : null}

      {authReady && !isLoggedIn ? (
        <Card className="mb-4 space-y-4 border-amber-200 bg-amber-50/80 p-5">
          <div>
            <h3 className="font-semibold text-amber-950">Sign in required</h3>
            <p className="mt-2 text-sm text-amber-900/90">
              You must sign in to CNothing before you can approve. After signing in you will return
              to this page.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={buildV4GitHubStartUrl(connection, returnTo)}>
              <Button>Sign in with GitHub</Button>
            </a>
            <a href={`/login?redirect_after=${encodeURIComponent(returnTo)}`}>
              <Button variant="outline">Other sign-in options</Button>
            </a>
          </div>
        </Card>
      ) : null}

      {isLoggedIn && session?.userId ? (
        <Card className="mb-4 p-4 text-sm text-slate-600">
          Signed in as <span className="font-medium text-slate-900">{session.userId}</span>
        </Card>
      ) : null}

      {request ? (
        <Card className="mb-4 p-5">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Agent {request.agent_id}</h3>
            <Badge>{request.status}</Badge>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <p>
              <span className="font-medium">Provider:</span> {request.provider}
            </p>
            <p>
              <span className="font-medium">Requested API hosts:</span>{" "}
              {request.requested_hosts.join(", ")}
            </p>
            {request.reason ? (
              <p>
                <span className="font-medium">Reason:</span> {request.reason}
              </p>
            ) : null}
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            This grants the agent access to every API on the listed hosts through your connection.
            Approve only if you trust this agent.
          </div>
        </Card>
      ) : null}

      {isLoggedIn && request?.status === "pending" ? (
        matchingConnections.length > 0 ? (
          <Card className="mb-4 space-y-4 border-[color:var(--brand)]/30 p-5">
            <div>
              <h3 className="font-semibold">Choose connection and approve</h3>
              <p className="mt-1 text-sm text-slate-600">
                Select the {request.provider} connection the agent may use, then approve.
              </p>
            </div>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={selectedConnectionId}
              onChange={(event) => setSelectedConnectionId(event.target.value)}
            >
              {matchingConnections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.provider_display_name} — {item.display_name || item.provider_account_id}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleApprove()}>Approve Access</Button>
              <Button variant="outline" onClick={() => void handleDeny()}>
                Deny
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="mb-4 space-y-4 border-rose-200 bg-rose-50/70 p-5">
            <div>
              <h3 className="font-semibold text-rose-950">
                No active {request.provider} connection
              </h3>
              <p className="mt-2 text-sm text-rose-900/90">
                Signing in to CNothing is not enough. You must also connect the{" "}
                <strong>{request.provider}</strong> provider once so CNothing can inject tokens for
                the agent. After connecting, return to this page to approve.
              </p>
              {session?.userId ? (
                <p className="mt-2 text-sm text-rose-900/90">
                  Current account: <code className="text-xs">{session.userId}</code>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`/connect?redirect_after=${encodeURIComponent(returnTo)}`}>
                <Button>Connect {request.provider} at /connect</Button>
              </a>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Refresh this page
              </Button>
            </div>
          </Card>
        )
      ) : null}

      {isLoggedIn && request && request.status !== "pending" ? (
        <Card className="mb-4 p-5 text-sm text-slate-600">
          This request is already <strong>{request.status}</strong>. No further action is needed
          here.
          {request.status === "approved"
            ? " The agent can use its grant_id with POST /v4/proxy."
            : null}
        </Card>
      ) : null}

      {statusMessage ? <Card className="mb-4 p-4 text-sm text-green-700">{statusMessage}</Card> : null}
      {errorMessage ? <Card className="mb-4 p-4 text-sm text-red-700">{errorMessage}</Card> : null}
    </PageFrame>
  );
}
