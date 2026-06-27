"use client";

import * as React from "react";
import { Link2, Plus } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import {
  fetchOAuthProviders,
  startOAuthConnect,
  type V25OAuthProvider,
} from "@/lib/api-v2";

export function ConnectPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { isLoggedIn } = useUserSession();
  const [providers, setProviders] = React.useState<V25OAuthProvider[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchOAuthProviders(connection);
      setProviders(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load providers.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleConnect(provider: V25OAuthProvider) {
    if (!isLoggedIn) {
      setErrorMessage("Sign in first from the Login page.");
      return;
    }
    try {
      const redirectAfter =
        typeof window !== "undefined" ? `${window.location.origin}/connections` : undefined;
      const response = await startOAuthConnect(connection, {
        provider_slug: provider.slug,
        redirect_after: redirectAfter,
      });
      window.location.href = response.authorization_url;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to start OAuth flow.");
    }
  }

  return (
    <PageFrame
      title="Connect Providers"
      description="Connect OAuth2/OIDC providers once. CNothing stores tokens encrypted — agents never receive them."
      actions={<ReloadIconButton loading={loading} onClick={() => void refresh()} />}
    >
      <ConnectionPanel draft={draft} setDraft={setDraft} onSave={saveDraft} />

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((provider) => (
          <Card key={provider.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-[#ca279c]" />
                  <h3 className="font-semibold">{provider.display_name}</h3>
                  {provider.is_builtin ? <Badge variant="secondary">Built-in</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-slate-600">{provider.slug}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant={provider.connectable ? "default" : "outline"}>
                    {provider.connectable ? "Ready" : "Not configured"}
                  </Badge>
                  <Badge variant="outline">{provider.auth_type}</Badge>
                </div>
              </div>
              <Button
                disabled={!provider.connectable || !isLoggedIn}
                onClick={() => void handleConnect(provider)}
              >
                Connect
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          <h3 className="font-semibold">Custom OAuth Provider</h3>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Register custom providers via admin API: <code>POST /v2/oauth/providers</code>
        </p>
      </Card>
    </PageFrame>
  );
}
