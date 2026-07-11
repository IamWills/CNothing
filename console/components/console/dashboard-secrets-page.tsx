"use client";

import * as React from "react";
import { KeyRound } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { fetchGatewaySecrets, type GatewaySecretMeta } from "@/lib/api-v3";
import { dashboardTabs } from "@/lib/v2-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function DashboardSecretsPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [items, setItems] = React.useState<GatewaySecretMeta[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchGatewaySecrets(connection, 100);
      setItems(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load secret metadata.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageFrame
      title="Secret Vault"
      description="Metadata only — secret values are encrypted at rest, never returned to agents, APIs, or this console."
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
        errorMessage={errorMessage}
      />

      <Card className="border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-950">
        Secrets never leave cnothing. This page shows fingerprint, type, owner, and status — never plaintext tokens.
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Vault metadata</h2>
          </div>
        </div>
        <div className="divide-y">
          {items.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No vault secrets yet. Connect a provider to store encrypted tokens.</p>
          ) : (
            items.map((secret) => (
              <div key={secret.secret_ref} className="grid gap-2 px-6 py-4 lg:grid-cols-[1.4fr_1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium font-mono text-sm">{secret.secret_ref.slice(0, 16)}…</p>
                    <Badge>{secret.secret_type}</Badge>
                    <Badge>{secret.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    owner={secret.owner_type}:{secret.owner_id.slice(0, 12)}…
                    {secret.provider_id ? ` · provider=${secret.provider_id}` : ""}
                  </p>
                </div>
                <p className="font-mono text-xs text-slate-500">fp={secret.fingerprint.slice(0, 16)}…</p>
                <p className="text-xs text-slate-500">{formatDate(secret.created_at)}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
