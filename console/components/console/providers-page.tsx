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
import { useConsoleAuth } from "@/hooks/use-console-auth";
import {
  createV4Provider,
  fetchV4ProvidersAdmin,
  proposeV4Provider,
  updateV4Provider,
  updateV4ProviderCredentials,
  type V4OAuthProviderAdmin,
} from "@/lib/api-v4";
import { brand } from "@/lib/brand";
import { consoleTabs } from "@/lib/v4-channel-tabs";

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

const registryBadgeClass: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  disabled: "bg-slate-200 text-slate-700",
  discovered: "bg-violet-100 text-violet-800",
  unverified: "bg-amber-100 text-amber-800",
  reviewed: "bg-sky-100 text-sky-800",
};

function registryLabel(provider: V4OAuthProviderAdmin): string {
  return (provider.registry_status ?? provider.status).toUpperCase();
}

export function ProvidersPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { isLoggedIn, isAdmin, session } = useConsoleAuth();
  const [providers, setProviders] = React.useState<V4OAuthProviderAdmin[]>([]);
  const [createForm, setCreateForm] = React.useState(emptyCreateForm);
  const [proposeIssuer, setProposeIssuer] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [credentialForms, setCredentialForms] = React.useState<
    Record<string, { client_id: string; client_secret: string }>
  >({});
  const [metadataForms, setMetadataForms] = React.useState<
    Record<string, { issuer: string; authorization_url: string; token_url: string }>
  >({});
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const selected = providers.find((provider) => provider.id === selectedId) ?? null;

  const refresh = React.useCallback(async () => {
    if (!isAdmin) {
      setProviders([]);
      return;
    }
    setLoading(true);
    setErrorMessage("");
    try {
      const providerResponse = await fetchV4ProvidersAdmin(connection);
      setProviders(providerResponse.items);
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
      setMetadataForms((prev) => {
        const next = { ...prev };
        for (const provider of providerResponse.items) {
          if (!next[provider.id]) {
            next[provider.id] = {
              issuer: provider.issuer ?? "",
              authorization_url: provider.authorization_url ?? "",
              token_url: provider.token_url ?? "",
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
  }, [connection, isAdmin]);

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
      const payload: Parameters<typeof createV4Provider>[1] = {
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
      const response = await createV4Provider(connection, payload);
      setStatusMessage(`Registered provider ${response.provider.display_name}.`);
      setCreateForm(emptyCreateForm);
      setSelectedId(response.provider.id);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Provider registration failed.");
    }
  }

  async function handleProposeProvider(event: React.FormEvent) {
    event.preventDefault();
    if (!proposeIssuer.trim()) {
      setErrorMessage("Issuer or discovery URL is required.");
      return;
    }
    setErrorMessage("");
    setStatusMessage("");
    try {
      const value = proposeIssuer.trim();
      const payload = value.includes("openid-configuration") || value.includes("oauth-authorization-server")
        ? { discovery_url: value }
        : { issuer: value };
      const response = await proposeV4Provider(connection, payload);
      setStatusMessage(
        `Proposal ${response.provider.display_name} is ${registryLabel(response.provider)}.`,
      );
      setProposeIssuer("");
      setSelectedId(response.provider.id);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Provider proposal failed.");
    }
  }

  async function handleSaveCredentials(provider: V4OAuthProviderAdmin) {
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
      await updateV4ProviderCredentials(connection, provider.id, payload);
      setStatusMessage(`Updated credentials for ${provider.display_name}.`);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Credential update failed.");
    }
  }

  async function handleSaveMetadata(provider: V4OAuthProviderAdmin) {
    const form = metadataForms[provider.id];
    if (!form) return;
    setErrorMessage("");
    setStatusMessage("");
    try {
      const payload: Parameters<typeof updateV4Provider>[2] = {};
      if (form.issuer.trim()) payload.issuer = form.issuer.trim();
      if (form.authorization_url.trim()) payload.authorization_url = form.authorization_url.trim();
      if (form.token_url.trim()) payload.token_url = form.token_url.trim();
      await updateV4Provider(connection, provider.id, payload);
      setStatusMessage(`Updated OAuth metadata for ${provider.display_name}.`);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Metadata update failed.");
    }
  }

  async function handlePatch(
    provider: V4OAuthProviderAdmin,
    payload: Parameters<typeof updateV4Provider>[2],
    message: string,
  ) {
    setErrorMessage("");
    setStatusMessage("");
    try {
      await updateV4Provider(connection, provider.id, payload);
      setStatusMessage(message);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Provider update failed.");
    }
  }

  return (
    <PageFrame
      title="Provider Registry"
      description={`${brand.tagline}. One registry for every provider agents connect to and users sign in with; tokens stay in the encrypted vault.`}
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
          Sign in at /login. Provider registry management requires an admin role.
        </Card>
      ) : !isAdmin ? (
        <Card className="p-4 text-sm text-slate-600">
          Signed in as {session?.userId}. Provider registry changes are limited to administrators.
        </Card>
      ) : null}

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}
      {statusMessage ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{statusMessage}</Card>
      ) : null}

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Link2 className="h-4 w-4 text-[#ca279c]" />
          <h3 className="font-semibold">Providers</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => setSelectedId(provider.id === selectedId ? null : provider.id)}
              className="flex w-full items-center justify-between gap-3 py-2 text-left"
            >
              <span className="font-medium">{provider.display_name}</span>
              <span className="flex items-center gap-2">
                <Badge variant="outline">{provider.slug}</Badge>
                <Badge className={registryBadgeClass[provider.registry_status ?? provider.status] ?? ""}>
                  {registryLabel(provider)}
                </Badge>
              </span>
            </button>
          ))}
          {providers.length === 0 ? (
            <p className="py-2 text-sm text-slate-500">No providers registered yet.</p>
          ) : null}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[#ca279c]" />
          <h3 className="font-semibold">Discover provider</h3>
        </div>
        <form className="flex flex-col gap-3 md:flex-row" onSubmit={(event) => void handleProposeProvider(event)}>
          <Input
            placeholder="https://accounts.google.com or a discovery URL"
            value={proposeIssuer}
            onChange={(event) => setProposeIssuer(event.target.value)}
          />
          <Button type="submit">Review proposal</Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          Discovery metadata is untrusted. The row stays DISCOVERED until an operator reviews it and
          adds credentials.
        </p>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[#ca279c]" />
          <h3 className="font-semibold">Add provider</h3>
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
            <Input
              id="discovery-url"
              placeholder="https://accounts.google.com/.well-known/openid-configuration"
              value={createForm.discovery_url}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, discovery_url: event.target.value }))
              }
            />
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

      {selected ? (
        <ProviderDetail
          provider={selected}
          credentialForm={
            credentialForms[selected.id] ?? {
              client_id: selected.client_id ?? "",
              client_secret: "",
            }
          }
          metadataForm={
            metadataForms[selected.id] ?? {
              issuer: selected.issuer ?? "",
              authorization_url: selected.authorization_url ?? "",
              token_url: selected.token_url ?? "",
            }
          }
          onCredentialChange={(next) =>
            setCredentialForms((prev) => ({ ...prev, [selected.id]: next }))
          }
          onMetadataChange={(next) =>
            setMetadataForms((prev) => ({ ...prev, [selected.id]: next }))
          }
          onSaveCredentials={() => void handleSaveCredentials(selected)}
          onSaveMetadata={() => void handleSaveMetadata(selected)}
          onReview={() =>
            void handlePatch(selected, { reviewed: true }, `Reviewed ${selected.display_name}.`)
          }
          onActivate={() =>
            void handlePatch(selected, { status: "active" }, `Activated ${selected.display_name}.`)
          }
          onDisable={() =>
            void handlePatch(selected, { status: "disabled" }, `Disabled ${selected.display_name}.`)
          }
        />
      ) : null}
    </PageFrame>
  );
}

function ProviderDetail(props: {
  provider: V4OAuthProviderAdmin;
  credentialForm: { client_id: string; client_secret: string };
  metadataForm: { issuer: string; authorization_url: string; token_url: string };
  onCredentialChange: (next: { client_id: string; client_secret: string }) => void;
  onMetadataChange: (next: { issuer: string; authorization_url: string; token_url: string }) => void;
  onSaveCredentials: () => void;
  onSaveMetadata: () => void;
  onReview: () => void;
  onActivate: () => void;
  onDisable: () => void;
}) {
  const { provider, credentialForm, metadataForm } = props;
  const validation = provider.validation;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link2 className="h-4 w-4 text-[#ca279c]" />
            <h3 className="font-semibold">{provider.display_name}</h3>
            <Badge variant="outline">{provider.slug}</Badge>
            <Badge className={registryBadgeClass[provider.registry_status ?? provider.status] ?? ""}>
              {registryLabel(provider)}
            </Badge>
            {provider.connectable ? (
              <Badge className="bg-emerald-100 text-emerald-800">Connectable</Badge>
            ) : provider.client_id || provider.has_client_secret ? (
              <Badge className="bg-amber-100 text-amber-800">Needs activation</Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-800">Needs credentials</Badge>
            )}
            {provider.login_enabled ? (
              <Badge className="bg-sky-100 text-sky-800">Console login</Badge>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {provider.authorization_url ?? "No authorization URL configured"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
            <span>source: {provider.source ?? "manual"}</span>
            <span>method: {provider.registration_method ?? "manual"}</span>
            {provider.is_builtin ? <span>Built-in</span> : null}
            {provider.has_client_secret ? <span>Secret stored</span> : null}
            {provider.pkce_required ? <span>PKCE</span> : null}
            {provider.reviewed_at ? <span>reviewed {provider.reviewed_at}</span> : null}
          </div>
        </div>
        <ShieldCheck className="h-5 w-5 text-slate-400" />
      </div>

      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        {validation ? (
          validation.ok ? (
            <div className="space-y-1">
              <p>
                Validation passed at {validation.checked_at} ({validation.method}).
              </p>
              {validation.dynamic_client_registration?.ok ? (
                <p>
                  RFC 7591 registered a client. Review, then Activate — you do not need to paste a
                  secret.
                </p>
              ) : null}
              {validation.dynamic_client_registration?.attempted &&
              !validation.dynamic_client_registration.ok ? (
                <p className="text-amber-800">
                  RFC 7591 registration failed
                  {validation.dynamic_client_registration.error
                    ? `: ${validation.dynamic_client_registration.error}`
                    : ""}
                  . Paste client credentials below if this provider requires them.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-amber-800">
              Validation failed: {validation.error ?? "unknown error"}
            </p>
          )
        ) : (
          <p className="text-slate-600">No validation result stored yet.</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {provider.registry_status === "discovered" || provider.registry_status === "unverified" ? (
          <Button type="button" variant="outline" onClick={props.onReview}>
            Mark reviewed
          </Button>
        ) : null}
        {provider.status !== "active" ? (
          <Button type="button" onClick={props.onActivate}>
            Activate
          </Button>
        ) : null}
        {provider.status !== "disabled" ? (
          <Button type="button" variant="outline" onClick={props.onDisable}>
            Disable
          </Button>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor={`issuer-${provider.id}`}>Issuer</Label>
          <Input
            id={`issuer-${provider.id}`}
            value={metadataForm.issuer}
            onChange={(event) =>
              props.onMetadataChange({ ...metadataForm, issuer: event.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`auth-${provider.id}`}>Authorization URL</Label>
          <Input
            id={`auth-${provider.id}`}
            value={metadataForm.authorization_url}
            onChange={(event) =>
              props.onMetadataChange({ ...metadataForm, authorization_url: event.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`token-${provider.id}`}>Token URL</Label>
          <Input
            id={`token-${provider.id}`}
            value={metadataForm.token_url}
            onChange={(event) =>
              props.onMetadataChange({ ...metadataForm, token_url: event.target.value })
            }
          />
        </div>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={props.onSaveMetadata}>
            Save metadata
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor={`client-id-${provider.id}`}>Client ID</Label>
          <Input
            id={`client-id-${provider.id}`}
            value={credentialForm.client_id}
            onChange={(event) =>
              props.onCredentialChange({ ...credentialForm, client_id: event.target.value })
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
              props.onCredentialChange({ ...credentialForm, client_secret: event.target.value })
            }
          />
        </div>
        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={props.onSaveCredentials}>
            Save credentials
          </Button>
        </div>
      </div>
    </Card>
  );
}
