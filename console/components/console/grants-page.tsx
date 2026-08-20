"use client";

import * as React from "react";
import { Shield, XCircle } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import { fetchV4Grants, revokeV4Grant, type V4Grant } from "@/lib/api-v4";
import { v4ChannelTabs } from "@/lib/v4-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function GrantsPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { isLoggedIn } = useUserSession();
  const [grants, setGrants] = React.useState<V4Grant[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchV4Grants(connection);
      setGrants(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load grants.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRevoke(grantId: string) {
    setErrorMessage("");
    setStatusMessage("");
    try {
      await revokeV4Grant(connection, grantId);
      setStatusMessage("Grant revoked. The agent can no longer call APIs with it.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Revoke failed.");
    }
  }

  return (
    <PageFrame
      title="Grants"
      description="Delegated authority you approved for agents. Each grant is a mandate: one principal, one agent, one connection, and the host/method constraints the proxy will enforce. The agent never sees your tokens."
      actions={
        <>
          <ReloadIconButton onReload={() => void refresh()} disabled={loading} />
          <ChannelRouteTabs items={v4ChannelTabs} />
        </>
      }
    >
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
      />

      {!isLoggedIn ? (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Sign in first (Login page) to see the grants tied to your account.
        </Card>
      ) : null}

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}
      {statusMessage ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{statusMessage}</Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b border-[color:var(--border)] px-6 py-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Your grants</h2>
          </div>
        </div>
        <div className="divide-y divide-[color:var(--border)]">
          {grants.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No grants yet. Agents request access; you approve them once.</p>
          ) : (
            grants.map((grant) => (
              <div key={grant.id} className="grid gap-3 px-6 py-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm text-slate-900">{grant.id}</p>
                    <Badge variant={grant.status === "active" ? "default" : "secondary"}>{grant.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    Agent: <span className="font-mono">{grant.agent_id}</span>
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Hosts: {grant.allowed_hosts.join(", ") || "—"} · Methods: {grant.allowed_methods.join(", ") || "—"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Created {formatDate(grant.created_at)}
                    {grant.last_used_at ? ` · Last used ${formatDate(grant.last_used_at)}` : ""}
                  </p>
                </div>
                <div className="flex items-start">
                  {grant.status === "active" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRevoke(grant.id)}
                    >
                      <XCircle className="mr-1 h-4 w-4" />
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
