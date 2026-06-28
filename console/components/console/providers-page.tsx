"use client";

import * as React from "react";
import { KeyRound, Link2, ShieldCheck } from "lucide-react";
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
import {
  createOAuthProvider,
  fetchOAuthProvidersAdmin,
  updateOAuthProviderCredentials,
  type V25OAuthProviderAdmin,
} from "@/lib/api-v2";
import { v2ChannelTabs } from "@/lib/v2-channel-tabs";

const emptyCreateForm = {
  slug: "",
  display_name: "",
  authorization_url: "",
  token_url: "",
  userinfo_url: "",
  revoke_url: "",
  client_id: "",
  client_secret: "",
  default_scopes: '["openid"]',
  supported_scopes: '["openid"]',
};

export function ProvidersPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [providers, setProviders] = React.useState<V25OAuthProviderAdmin[]>([]);
  const [createForm, setCreateForm] = React.useState(emptyCreateForm);
  const [credentialForms, setCredentialForms] = React.useState<
    Record<string, { client_id: string; client_secret: string }>
  >({});
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchOAuthProvidersAdmin(connection);
      setProviders(response.items);
      setCredentialForms((prev) => {
        const next = { ...prev };
        for (const provider of response.items) {
          if (!next[provider.id]) {
            next[provider.id] = {
              client_id: provider.client_id ?? "",
              client_secret: "",
            };
          }
        }
        return next;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load providers.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreateProvider(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
      const parseScopeList = (raw: string): string[] => {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed.map(String) : [];
      };
      const payload: Parameters<typeof createOAuthProvider>[1] = {
        slug: createForm.slug.trim(),
        display_name: createForm.display_name.trim(),
        default_scopes: parseScopeList(createForm.default_scopes),
        supported_scopes: parseScopeList(createForm.supported_scopes),
      };
      const authorizationUrl = createForm.authorization_url.trim();
      const tokenUrl = createForm.token_url.trim();
      const userinfoUrl = createForm.userinfo_url.trim();
      const revokeUrl = createForm.revoke_url.trim();
      const clientId = createForm.client_id.trim();
      const clientSecret = createForm.client_secret.trim();
      if (authorizationUrl) payload.authorization_url = authorizationUrl;
      if (tokenUrl) payload.token_url = tokenUrl;
      if (userinfoUrl) payload.userinfo_url = userinfoUrl;
      if (revokeUrl) payload.revoke_url = revokeUrl;
      if (clientId) payload.client_id = clientId;
      if (clientSecret) payload.client_secret = clientSecret;
      const response = await createOAuthProvider(connection, payload);
      setStatusMessage(`Registered provider ${response.provider.display_name}.`);
      setCreateForm(emptyCreateForm);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Provider registration failed.");
    }
  }

  async function handleSaveCredentials(provider: V25OAuthProviderAdmin) {
    const form = credentialForms[provider.id];
    if (!form?.client_id.trim()) {
      setErrorMessage("Client ID is required.");
      return;
    }
    setErrorMessage("");
    setStatusMessage("");
    try {
      const payload: { client_id: string; client_secret?: string } = {
        client_id: form.client_id.trim(),
      };
      const clientSecret = form.client_secret.trim();
      if (clientSecret) payload.client_secret = clientSecret;
      await updateOAuthProviderCredentials(connection, provider.id, payload);
      setStatusMessage(`Updated credentials for ${provider.display_name}.`);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Credential update failed.");
    }
  }

  return (
    <PageFrame
      title="OAuth Providers"
      description="Register third-party OAuth providers for the Universal OAuth Broker. Users connect once on the Connect page; imported capabilities bind to these providers."
      actions={
        <>
          <ReloadIconButton onReload={() => void refresh()} disabled={loading} />
          <ChannelRouteTabs items={v2ChannelTabs} />
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

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[#ca279c]" />
          <h3 className="font-semibold">Register provider</h3>
        </div>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void handleCreateProvider(event)}>
          <div className="space-y-2">
            <Label htmlFor="provider-slug">Slug</Label>
            <Input
              id="provider-slug"
              placeholder="notion"
              value={createForm.slug}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, slug: event.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="provider-name">Display name</Label>
            <Input
              id="provider-name"
              placeholder="Notion"
              value={createForm.display_name}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, display_name: event.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="authorization-url">Authorization URL</Label>
            <Input
              id="authorization-url"
              value={createForm.authorization_url}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, authorization_url: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token-url">Token URL</Label>
            <Input
              id="token-url"
              value={createForm.token_url}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, token_url: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-id">Client ID</Label>
            <Input
              id="client-id"
              value={createForm.client_id}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, client_id: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-secret">Client secret</Label>
            <Input
              id="client-secret"
              type="password"
              value={createForm.client_secret}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, client_secret: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="default-scopes">Default scopes (JSON array)</Label>
            <Input
              id="default-scopes"
              value={createForm.default_scopes}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, default_scopes: event.target.value }))
              }
            />
          </div>
          <div className="md:col-span-2">
            <Button type="submit">Register provider</Button>
          </div>
        </form>
      </Card>

      <div className="grid gap-4">
        {providers.map((provider) => {
          const credentialForm = credentialForms[provider.id] ?? {
            client_id: provider.client_id ?? "",
            client_secret: "",
          };
          return (
            <Card key={provider.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-[#ca279c]" />
                    <h3 className="font-semibold">{provider.display_name}</h3>
                    <Badge variant="outline">{provider.slug}</Badge>
                    <Badge variant="outline">{provider.status}</Badge>
                    {provider.connectable ? (
                      <Badge className="bg-emerald-100 text-emerald-800">Connectable</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800">Needs credentials</Badge>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {provider.authorization_url ?? "No authorization URL configured"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    {provider.is_builtin ? <span>Built-in</span> : null}
                    {provider.has_client_secret ? <span>Secret stored</span> : null}
                    {provider.pkce_required ? <span>PKCE</span> : null}
                  </div>
                </div>
                <ShieldCheck className="h-5 w-5 text-slate-400" />
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <div className="space-y-2">
                  <Label htmlFor={`client-id-${provider.id}`}>Client ID</Label>
                  <Input
                    id={`client-id-${provider.id}`}
                    value={credentialForm.client_id}
                    onChange={(event) =>
                      setCredentialForms((prev) => ({
                        ...prev,
                        [provider.id]: {
                          ...credentialForm,
                          client_id: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`client-secret-${provider.id}`}>Client secret</Label>
                  <Input
                    id={`client-secret-${provider.id}`}
                    type="password"
                    placeholder={provider.has_client_secret ? "Leave blank to keep existing" : ""}
                    value={credentialForm.client_secret}
                    onChange={(event) =>
                      setCredentialForms((prev) => ({
                        ...prev,
                        [provider.id]: {
                          ...credentialForm,
                          client_secret: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div className="flex items-end">
                  <Button type="button" variant="outline" onClick={() => void handleSaveCredentials(provider)}>
                    Save credentials
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </PageFrame>
  );
}
