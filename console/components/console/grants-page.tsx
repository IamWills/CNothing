"use client";

import * as React from "react";
import { CheckCircle2, Shield, XCircle } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { LegacyBanner } from "@/components/layout/legacy-banner";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import {
  approveV3PendingConfirmation,
  createV3Grant,
  fetchV3Agents,
  fetchV3Capabilities,
  fetchV3Grants,
  fetchV3PendingConfirmations,
  rejectV3PendingConfirmation,
  revokeV3Grant,
  type V2PendingConfirmation,
  type V3Grant,
} from "@/lib/api-v3";
import { v2ChannelTabs } from "@/lib/v2-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function GrantsPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { session } = useUserSession();
  const [grants, setGrants] = React.useState<V3Grant[]>([]);
  const [pending, setPending] = React.useState<V2PendingConfirmation[]>([]);
  const [agentOptions, setAgentOptions] = React.useState<Array<{ id: string; name: string }>>([]);
  const [capabilityOptions, setCapabilityOptions] = React.useState<Array<{ name: string }>>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [form, setForm] = React.useState({
    user_id: "user123",
    agent_id: "",
    capability: "",
  });

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const [grantsResponse, pendingResponse, agentsResponse, capabilitiesResponse] = await Promise.all([
        fetchV3Grants(connection),
        fetchV3PendingConfirmations(connection, session?.sessionToken),
        fetchV3Agents(connection),
        fetchV3Capabilities(connection),
      ]);
      setGrants(grantsResponse.items);
      setPending(pendingResponse.items);
      setAgentOptions(agentsResponse.items.map((agent) => ({ id: agent.id, name: agent.name })));
      setCapabilityOptions(capabilitiesResponse.items.map((capability) => ({ name: capability.name })));
      setForm((prev) => ({
        ...prev,
        agent_id: prev.agent_id || agentsResponse.items[0]?.id || "",
        capability: prev.capability || capabilitiesResponse.items[0]?.name || "",
      }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load grants.");
    } finally {
      setLoading(false);
    }
  }, [connection, session?.sessionToken]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreateGrant(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
      await createV3Grant(connection, form);
      setStatusMessage(`Granted ${form.capability} to agent.`);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Grant creation failed.");
    }
  }

  async function handleRevoke(grantId: string) {
    setErrorMessage("");
    try {
      await revokeV3Grant(connection, grantId);
      setStatusMessage("Grant revoked.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Revoke failed.");
    }
  }

  async function handleApproveConfirmation(confirmationId: string) {
    setErrorMessage("");
    try {
      await approveV3PendingConfirmation(connection, confirmationId, session?.sessionToken);
      setStatusMessage("Confirmation approved. Agent can retry invoke with confirmation_id.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Approve failed.");
    }
  }

  async function handleRejectConfirmation(confirmationId: string) {
    setErrorMessage("");
    try {
      await rejectV3PendingConfirmation(connection, confirmationId, session?.sessionToken);
      setStatusMessage("Confirmation rejected.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Reject failed.");
    }
  }

  return (
    <PageFrame
      title="Grants & Confirmations"
      description="Users authorize agents via capability grants. Prefer Dashboard Approvals for execution confirmations."
      actions={
        <>
          <ReloadIconButton onReload={() => void refresh()} disabled={loading} />
          <ChannelRouteTabs items={v2ChannelTabs} />
        </>
      }
    >
      <LegacyBanner preferredHref="/dashboard/approvals" preferredLabel="Dashboard Approvals" />
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
      />

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}
      {statusMessage ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{statusMessage}</Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Create grant</h2>
          </div>
          <form className="space-y-4" onSubmit={(event) => void handleCreateGrant(event)}>
            <div className="space-y-2">
              <Label>User ID</Label>
              <Input
                value={form.user_id}
                onChange={(event) => setForm((prev) => ({ ...prev, user_id: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Agent</Label>
              <select
                className="w-full rounded-md border border-[color:var(--border)] bg-white px-3 py-2 text-sm"
                value={form.agent_id}
                onChange={(event) => setForm((prev) => ({ ...prev, agent_id: event.target.value }))}
                required
              >
                <option value="">Select agent</option>
                {agentOptions.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Capability</Label>
              <select
                className="w-full rounded-md border border-[color:var(--border)] bg-white px-3 py-2 text-sm"
                value={form.capability}
                onChange={(event) => setForm((prev) => ({ ...prev, capability: event.target.value }))}
                required
              >
                <option value="">Select capability</option>
                {capabilityOptions.map((capability) => (
                  <option key={capability.name} value={capability.name}>
                    {capability.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" className="w-full">
              Grant capability
            </Button>
          </form>
        </Card>

        <div className="space-y-6">
          {pending.length > 0 ? (
            <Card className="overflow-hidden border-amber-200">
              <div className="border-b bg-amber-50 px-6 py-4">
                <h2 className="text-lg font-semibold text-amber-950">Pending confirmations</h2>
              </div>
              <div className="divide-y">
                {pending.map((item) => (
                  <div key={item.id} className="space-y-3 px-6 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{item.capability_name}</p>
                      <Badge>{item.agent_name}</Badge>
                    </div>
                    <p className="text-sm text-slate-600">User: {item.user_id}</p>
                    {item.reason ? <p className="text-sm text-slate-600">{item.reason}</p> : null}
                    <pre className="overflow-x-auto rounded bg-slate-50 p-3 text-xs">
                      {JSON.stringify(item.input, null, 2)}
                    </pre>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void handleApproveConfirmation(item.id)}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Approve
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => void handleRejectConfirmation(item.id)}>
                        <XCircle className="mr-2 h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Active grants</h2>
            </div>
            <div className="divide-y">
              {grants.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No active grants.</p>
              ) : (
                grants.map((grant) => (
                  <div key={grant.id} className="grid gap-3 px-6 py-4 lg:grid-cols-[1fr_auto]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{grant.capability_name}</p>
                        <Badge>{grant.connector_provider}</Badge>
                        {grant.grant_status ? <Badge>{grant.grant_status}</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        Agent {grant.agent_name} · User {grant.user_id}
                      </p>
                      {grant.connection_id ? (
                        <p className="mt-1 font-mono text-xs text-slate-500">
                          connection {grant.connection_id.slice(0, 8)}…
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-slate-500">{formatDate(grant.created_at)}</p>
                    </div>
                    <Button variant="secondary" onClick={() => void handleRevoke(grant.id)}>
                      Revoke
                    </Button>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </PageFrame>
  );
}
