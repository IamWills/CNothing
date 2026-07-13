"use client";

import * as React from "react";
import { Bot, KeyRound, ShieldCheck } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { fetchV3Agents, registerV3Agent, type V3Agent } from "@/lib/api-v3";
import { brand } from "@/lib/brand";
import { dashboardTabs } from "@/lib/v2-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function AgentsPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [agents, setAgents] = React.useState<V3Agent[]>([]);
  const [issuedToken, setIssuedToken] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", owner_user_id: "user123", tenant_id: "default" });

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchV3Agents(connection);
      setAgents(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load agents.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setIssuedToken(null);
    try {
      const response = await registerV3Agent(connection, form);
      setIssuedToken(response.access_token);
      setStatusMessage(`Registered agent ${response.agent.name}. Copy the access token now — it won't be shown again.`);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Registration failed.");
    }
  }

  return (
    <PageFrame
      title="Agents"
      description={`${brand.tagline}. Register agents that invoke capabilities secretlessly — never receive tokens.`}
      actions={
        <>
          <ReloadIconButton onReload={() => void refresh()} disabled={loading} />
          <ChannelRouteTabs items={dashboardTabs} />
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

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}
      {statusMessage ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{statusMessage}</Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Register Agent</h2>
          </div>
          <form className="space-y-4" onSubmit={(event) => void handleRegister(event)}>
            <div className="space-y-2">
              <Label htmlFor="agent-name">Agent name</Label>
              <Input
                id="agent-name"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="claude-desktop"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-user-id">Owner user ID</Label>
              <Input
                id="owner-user-id"
                value={form.owner_user_id}
                onChange={(event) => setForm((prev) => ({ ...prev, owner_user_id: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenant-id">Tenant ID</Label>
              <Input
                id="tenant-id"
                value={form.tenant_id}
                onChange={(event) => setForm((prev) => ({ ...prev, tenant_id: event.target.value }))}
                placeholder="default"
              />
            </div>
            <Button type="submit" className="w-full">
              Register agent
            </Button>
          </form>
          {issuedToken ? (
            <Card className="space-y-2 border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                <KeyRound className="h-4 w-4" />
                Agent access token
              </div>
              <code className="block overflow-x-auto rounded bg-white p-3 text-xs text-slate-800">{issuedToken}</code>
            </Card>
          ) : null}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-[color:var(--border)] px-6 py-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[color:var(--brand)]" />
              <h2 className="text-lg font-semibold">Registered agents</h2>
            </div>
          </div>
          <div className="divide-y divide-[color:var(--border)]">
            {agents.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No agents registered yet.</p>
            ) : (
              agents.map((agent) => (
                <div key={agent.id} className="grid gap-2 px-6 py-4 sm:grid-cols-[1fr_auto]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">{agent.name}</p>
                      <Badge>{agent.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      Owner: {agent.owner_user_id}
                      {agent.tenant_id && agent.tenant_id !== "default" ? ` · Tenant: ${agent.tenant_id}` : null}
                    </p>
                    <p className="mt-1 font-mono text-xs text-slate-500">{agent.id}</p>
                  </div>
                  <div className="text-sm text-slate-500">{formatDate(agent.created_at)}</div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </PageFrame>
  );
}
