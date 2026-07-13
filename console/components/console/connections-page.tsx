"use client";

import * as React from "react";
import { Unplug } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { LegacyBanner } from "@/components/layout/legacy-banner";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import {
  fetchV3OAuthConnections,
  revokeV3OAuthConnection,
  type V25OAuthConnection,
} from "@/lib/api-v3";
import { formatDate } from "@/lib/console-utils";

export function ConnectionsPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { isLoggedIn } = useUserSession();
  const [items, setItems] = React.useState<V25OAuthConnection[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!isLoggedIn) {
      setItems([]);
      return;
    }
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchV3OAuthConnections(connection);
      setItems(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load connections.");
    } finally {
      setLoading(false);
    }
  }, [connection, isLoggedIn]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRevoke(connectionId: string) {
    try {
      await revokeV3OAuthConnection(connection, connectionId);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to revoke connection.");
    }
  }

  return (
    <PageFrame
      title="OAuth Connections"
      description="Third-party connections with encrypted tokens stored by CNothing."
      actions={<ReloadIconButton disabled={loading} onReload={() => void refresh()} />}
    >
      <LegacyBanner preferredHref="/dashboard/connections" preferredLabel="Dashboard Connections" />
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
      />

      {!isLoggedIn ? (
        <Card className="p-4 text-sm text-slate-600">Sign in to view your connections.</Card>
      ) : null}

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}

      <div className="grid gap-4">
        {items.map((item) => (
          <Card key={item.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{item.display_name || item.provider_display_name}</h3>
                  <Badge variant={item.status === "active" ? "default" : "outline"}>{item.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {item.provider_display_name} · {item.provider_account_id}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Connected {formatDate(item.created_at)}
                  {item.last_used_at ? ` · Last used ${formatDate(item.last_used_at)}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.scopes.slice(0, 6).map((scope) => (
                    <Badge key={scope} variant="outline" className="text-xs">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button variant="outline" onClick={() => void handleRevoke(item.id)}>
                <Unplug className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            </div>
          </Card>
        ))}
        {isLoggedIn && items.length === 0 && !loading ? (
          <Card className="p-4 text-sm text-slate-600">No connections yet. Go to Connect to link a provider.</Card>
        ) : null}
      </div>
    </PageFrame>
  );
}
