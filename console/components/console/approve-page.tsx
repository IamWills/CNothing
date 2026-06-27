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
  approveV25Authorization,
  fetchAuthorizationRequest,
  fetchOAuthConnections,
  type V25OAuthConnection,
  type V2AuthorizationRequest,
} from "@/lib/api-v2";

export function ApprovePage({ authorizationId }: { authorizationId: string }) {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { isLoggedIn } = useUserSession();
  const [request, setRequest] = React.useState<V2AuthorizationRequest | null>(null);
  const [connections, setConnections] = React.useState<V25OAuthConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");

  React.useEffect(() => {
    void fetchAuthorizationRequest(connection, authorizationId)
      .then((response) => setRequest(response.authorization_request))
      .catch((error) =>
        setErrorMessage(error instanceof Error ? error.message : "Unable to load authorization."),
      );
    if (isLoggedIn) {
      void fetchOAuthConnections(connection)
        .then((response) => {
          setConnections(response.items.filter((item) => item.status === "active"));
          if (response.items[0]) {
            setSelectedConnectionId(response.items[0].id);
          }
        })
        .catch(() => setConnections([]));
    }
  }, [authorizationId, connection, isLoggedIn]);

  const capability = request?.capabilities[0];
  const isHighRisk =
    capability?.risk_level === "HIGH" || capability?.risk_level === "CONFIDENTIAL";

  async function handleApproveV25() {
    if (!selectedConnectionId) {
      setErrorMessage("Select an OAuth connection first.");
      return;
    }
    try {
      await approveV25Authorization(connection, authorizationId, {
        connection_id: selectedConnectionId,
      });
      setStatusMessage("Capability grant approved.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Approval failed.");
    }
  }

  if (!request) {
    return (
      <PageFrame title="Approve Capability" description="Loading authorization request…">
        <ConnectionPanel draft={draft} setDraft={setDraft} onSave={saveDraft} />
        {errorMessage ? <Card className="p-4 text-sm text-red-700">{errorMessage}</Card> : null}
      </PageFrame>
    );
  }

  return (
    <PageFrame
      title="Approve Agent Capability"
      description="Select an OAuth connection and approve the capability grant. Tokens are never shared with the agent."
    >
      <ConnectionPanel draft={draft} setDraft={setDraft} onSave={saveDraft} />

      <Card className="mb-4 p-5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{request.agent_name}</h3>
          <Badge>{request.status}</Badge>
        </div>
        {capability ? (
          <div className="mt-4 space-y-2">
            <p className="font-medium">{capability.name}</p>
            <p className="text-sm text-slate-600">{capability.description}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{capability.capability_type}</Badge>
              <Badge variant={isHighRisk ? "outline" : "secondary"} className={isHighRisk ? "border-amber-500 text-amber-800" : ""}>{capability.risk_level}</Badge>
            </div>
            {isHighRisk ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                High-risk or confidential capability — review carefully before approving.
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {connections.length > 0 ? (
        <Card className="mb-4 p-5">
          <h3 className="mb-3 font-semibold">OAuth Connection</h3>
          <select
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={selectedConnectionId}
            onChange={(event) => setSelectedConnectionId(event.target.value)}
          >
            {connections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.provider_display_name} — {item.display_name || item.provider_account_id}
              </option>
            ))}
          </select>
          <Button className="mt-4" disabled={!isLoggedIn} onClick={() => void handleApproveV25()}>
            Approve Grant
          </Button>
        </Card>
      ) : (
        <Card className="mb-4 p-5 text-sm text-slate-600">
          No OAuth connection found. Connect a provider at <a href="/connect">/connect</a> first.
        </Card>
      )}

      {statusMessage ? <Card className="mb-4 p-4 text-sm text-green-700">{statusMessage}</Card> : null}
      {errorMessage ? <Card className="mb-4 p-4 text-sm text-red-700">{errorMessage}</Card> : null}
    </PageFrame>
  );
}
