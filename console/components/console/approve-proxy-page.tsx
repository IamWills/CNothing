"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { PageFrame } from "@/components/layout/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import {
  approveV4AccessRequest,
  denyV4AccessRequest,
  fetchV4AccessRequest,
  fetchV4Connections,
  type V4AccessRequest,
} from "@/lib/api-v4";
import type { V4OAuthConnection } from "@/lib/api-v4";

export function ApproveProxyPage({ accessRequestId }: { accessRequestId: string }) {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { isLoggedIn } = useUserSession();
  const [request, setRequest] = React.useState<V4AccessRequest | null>(null);
  const [connections, setConnections] = React.useState<V4OAuthConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");

  React.useEffect(() => {
    if (!isLoggedIn) {
      return;
    }
    void fetchV4AccessRequest(connection, accessRequestId)
      .then(setRequest)
      .catch((error) =>
        setErrorMessage(error instanceof Error ? error.message : "Unable to load access request."),
      );
    void fetchV4Connections(connection)
      .then((response) => {
        const active = response.items.filter((item) => item.status === "active");
        setConnections(active);
        if (active[0]) {
          setSelectedConnectionId(active[0].id);
        }
      })
      .catch(() => setConnections([]));
  }, [accessRequestId, connection, isLoggedIn]);

  const matchingConnections = React.useMemo(
    () =>
      request
        ? connections.filter((item) => item.provider_slug === request.provider)
        : connections,
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
      setStatusMessage("Access request denied.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Deny failed.");
    }
  }

  return (
    <PageFrame
      title="Approve Proxy Access"
      description="Grant an agent connection-level API access. The agent sends plain HTTP requests through CNothing; tokens are injected server-side and never leave the platform."
    >
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
      />

      {!isLoggedIn ? (
        <Card className="mb-4 p-5 text-sm text-slate-600">
          Sign in first at <a href="/login" className="underline">/login</a> to review this access request.
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
          <Card className="mb-4 p-5">
            <h3 className="mb-3 font-semibold">OAuth Connection</h3>
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
            <div className="mt-4 flex gap-2">
              <Button onClick={() => void handleApprove()}>Approve Access</Button>
              <Button variant="outline" onClick={() => void handleDeny()}>
                Deny
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="mb-4 p-5 text-sm text-slate-600">
            No active {request.provider} connection found. Connect the provider at{" "}
            <a href="/connect" className="underline">/connect</a> first, then return to this page.
          </Card>
        )
      ) : null}

      {statusMessage ? <Card className="mb-4 p-4 text-sm text-green-700">{statusMessage}</Card> : null}
      {errorMessage ? <Card className="mb-4 p-4 text-sm text-red-700">{errorMessage}</Card> : null}
    </PageFrame>
  );
}
