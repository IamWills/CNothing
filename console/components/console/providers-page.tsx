"use client";

import * as React from "react";
import { KeyRound, Link2, ShieldCheck } from "lucide-react";
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
import {
  createOAuthProvider,
  discoverOAuthProvider,
  fetchOAuthProvidersAdmin,
  fetchProviderTemplates,
  syncOAuthProvidersFromEnv,
  updateOAuthProviderCredentials,
  type V25OAuthProviderAdmin,
  type V25ProviderTemplate,
} from "@/lib/api-v2";
import { brand } from "@/lib/brand";
import { dashboardTabs, v2ChannelTabs } from "@/lib/v2-channel-tabs";

const emptyCreateForm = {
  slug: "",
  display_name: "",
  discovery_url: "",
  issuer: "",
  authorization_url: "",
  token_url: "",
  userinfo_url: "",
  revoke_url: "",
  client_id: "",
  client_secret: "",
  default_scopes: '["openid"]',
  supported_scopes: '["openid"]',
};

type ProvidersPageProps = {
  adminBasePath?: string;
  apiVersion?: "v2.5" | "v2.6" | "v3";
  /** When true, show LegacyBanner and legacy channel tabs (pre-dashboard route). */
  legacySurface?: boolean;
};

export function ProvidersPage({
  adminBasePath,
  apiVersion = "v3",
  legacySurface = false,
}: ProvidersPageProps = {}) {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [providers, setProviders] = React.useState<V25OAuthProviderAdmin[]>([]);
  const [templates, setTemplates] = React.useState<V25ProviderTemplate[]>([]);
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
      const [providerResponse, templateResponse] = await Promise.all([
        fetchOAuthProvidersAdmin(connection, apiVersion),
        fetchProviderTemplates(connection),
      ]);
      setProviders(providerResponse.items);
      setTemplates(templateResponse.items);
      setCredentialForms((prev) => {
        const next = { ...prev };
        for (const provider of providerResponse.items) {
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
  }, [connection, apiVersion]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleDiscover() {
    setErrorMessage("");
    try {
      const payload: { discovery_url?: string; issuer?: string } = {};
      const discoveryUrl = createForm.discovery_url.trim();
      const issuer = createForm.issuer.trim();
      if (discoveryUrl) payload.discovery_url = discoveryUrl;
      if (issuer) payload.issuer = issuer;
      const response = await discoverOAuthProvider(connection, payload);
      const discovered = response.discovered;
      setCreateForm((prev) => ({
        ...prev,
        issuer: discovered.issuer,
        authorization_url: discovered.authorization_url,
        token_url: discovered.token_url,
        userinfo_url: discovered.userinfo_url ?? "",
        revoke_url: discovered.revoke_url ?? "",
        supported_scopes: JSON.stringify(discovered.scopes_supported.length ? discovered.scopes_supported : JSON.parse(prev.supported_scopes)),
      }));
      setStatusMessage("OIDC discovery completed — review URLs before saving.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "OIDC discovery failed.");
    }
  }

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
      if (createForm.discovery_url.trim()) payload.discovery_url = createForm.discovery_url.trim();
      if (createForm.issuer.trim()) payload.issuer = createForm.issuer.trim();
      if (clientId) payload.client_id = clientId;
      if (clientSecret) payload.client_secret = clientSecret;
      const response = await createOAuthProvider(connection, payload, apiVersion);
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

  async function handleSyncFromEnv() {
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await syncOAuthProvidersFromEnv(connection);
      const connectable = response.oauth_providers.filter((item) => item.connectable).length;
      setStatusMessage(`Synced OAuth credentials from environment (${connectable} connectable providers).`);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Environment sync failed.");
    }
  }

  return (
    <PageFrame
      title="OAuth Providers"
      description={`${brand.tagline}. Register third-party OAuth providers; tokens stay in Secret Vault.`}
      actions={
        <>
          <ReloadIconButton onReload={() => void refresh()} disabled={loading} />
          <ChannelRouteTabs items={legacySurface ? v2ChannelTabs : dashboardTabs} />
        </>
      }
    >
      {legacySurface ? (
        <LegacyBanner preferredHref="/dashboard/providers" preferredLabel="Dashboard Providers" />
      ) : null}
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Built-in provider templates</h3>
            <p className="mt-1 text-sm text-slate-600">
              Set env vars on the server, then sync credentials into the OAuth registry.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void handleSyncFromEnv()}>
            Sync from .env
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <div
              key={template.slug}
              className="rounded-md border border-slate-200 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{template.display_name}</span>
                <Badge variant="outline">{template.slug}</Badge>
                {template.connectable ? (
                  <Badge className="bg-emerald-100 text-emerald-800">Connectable</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-800">{template.status}</Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {template.capability_count} capabilities · {template.env_client_id_key ?? "no env key"}
              </p>
            </div>
          ))}
        </div>
      </Card>

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
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="discovery-url">OIDC Discovery URL (optional)</Label>
            <div className="flex gap-2">
              <Input
                id="discovery-url"
                placeholder="https://accounts.google.com/.well-known/openid-configuration"
                value={createForm.discovery_url}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, discovery_url: event.target.value }))
                }
              />
              {apiVersion === "v2.6" ? (
                <Button type="button" variant="outline" onClick={() => void handleDiscover()}>
                  Discover
                </Button>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="issuer">Issuer</Label>
            <Input
              id="issuer"
              value={createForm.issuer}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, issuer: event.target.value }))}
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
