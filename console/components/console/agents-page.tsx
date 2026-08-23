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
import { useConsoleAuth } from "@/hooks/use-console-auth";
import { sessionAccountLabel } from "@/hooks/use-user-session";
import { fetchV4Agents, registerV4Agent, revokeV4Agent, type V4Agent } from "@/lib/api-v4";
import { brand } from "@/lib/brand";
import { consoleTabs } from "@/lib/v4-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function AgentsPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { isLoggedIn, isAdmin, session } = useConsoleAuth();
  const [agents, setAgents] = React.useState<V4Agent[]>([]);
  const [issuedToken, setIssuedToken] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", owner_user_id: "" });

  React.useEffect(() => {
    if (session?.userId && !form.owner_user_id) {
      setForm((prev) => ({ ...prev, owner_user_id: session.userId }));
    }
  }, [session?.userId, form.owner_user_id]);

  const refresh = React.useCallback(async () => {
    if (!isLoggedIn) {
      setAgents([]);
      return;
    }
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchV4Agents(connection);
      setAgents(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load agents.");
    } finally {
      setLoading(false);
    }
  }, [connection, isLoggedIn]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRegister(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setIssuedToken(null);
    try {
      const response = await registerV4Agent(connection, form);
      setIssuedToken(response.access_token);
      setStatusMessage(
        `Registered agent ${response.agent.name}. Store this token in the host secret store now. Never paste it into a chat.`,
      );
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Registration failed.");
    }
  }

  return (
    <PageFrame
      title="Agents"
      description={`${brand.tagline}. Plugins pair themselves; you approve the runtime. The agent token never appears in chat.`}
      actions={
        <>
          <ReloadIconButton onReload={() => void refresh()} disabled={loading} />
          <ChannelRouteTabs items={consoleTabs(isAdmin)} />
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
        <Card className="p-4 text-sm text-slate-600">
          Sign in at /login. Your agent plugin will open an approval link; compare the pairing
          code, then approve. Spec: /plugin.md
        </Card>
      ) : (
        <Card className="p-4 text-sm text-slate-600">
          Signed in as {sessionAccountLabel(session)}. Plugins call POST /v4/agent-enrollments and
          send you an approval URL. This page lists runtimes you already approved.
        </Card>
      )}

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}
      {statusMessage ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{statusMessage}</Card>
      ) : null}

      <div className={`grid gap-6 ${isAdmin ? "lg:grid-cols-[380px_1fr]" : ""}`}>
        {isAdmin ? (
          <Card className="space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-[color:var(--brand)]" />
              <h2 className="text-lg font-semibold">Operator recovery</h2>
            </div>
            <p className="text-sm text-slate-600">
              Mint a token into a host secret store only. Do not paste it into a model conversation.
            </p>
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
              <Button type="submit" className="w-full">
                Register agent
              </Button>
            </form>
            {issuedToken ? (
              <Card className="space-y-2 border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                  <KeyRound className="h-4 w-4" />
                  Host secret only
                </div>
                <code className="block overflow-x-auto rounded bg-white p-3 text-xs text-slate-800">{issuedToken}</code>
              </Card>
            ) : null}
          </Card>
        ) : null}

        <Card className="overflow-hidden">
          <div className="border-b border-[color:var(--border)] px-6 py-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[color:var(--brand)]" />
              <h2 className="text-lg font-semibold">{isAdmin ? "Registered agents" : "Your agent runtimes"}</h2>
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
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <span>{formatDate(agent.created_at)}</span>
                    {agent.status === "active" ? (
                      <Button
                        variant="secondary"
                        onClick={() => void revokeV4Agent(connection, agent.id).then(refresh).catch((error) => {
                          setErrorMessage(error instanceof Error ? error.message : "Unable to revoke agent.");
                        })}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </PageFrame>
  );
}
