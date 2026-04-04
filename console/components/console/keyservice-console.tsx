"use client";

import * as React from "react";
import {
  BookKey,
  Fingerprint,
  KeyRound,
  RefreshCcw,
  Shield,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  fetchAuthaiPublicKey,
  fetchClients,
  fetchKvList,
  fetchKvValue,
  fetchMcpCatalog,
  fetchNamespaces,
  fetchSkills,
  registerClient,
  savePlaintextKv,
  type AuthaiPublicKey,
  type ClientSummary,
  type ConsoleConnection,
  type KvRecordSummary,
  type KvValueResponse,
  type McpResource,
  type McpTool,
  type NamespaceSummary,
  type RegisterClientResponse,
  type SkillEntry,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const STORAGE_KEY = "keyservice-console-settings";

type StoredSettings = {
  baseUrl: string;
  adminToken: string;
};

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseOptionalJson(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON metadata must be an object");
  }
  return parsed as Record<string, unknown>;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function KeyServiceConsole() {
  const initialBaseUrl =
    typeof window === "undefined" ? "" : window.location.origin;
  const [connection, setConnection] = React.useState<ConsoleConnection>({
    baseUrl: initialBaseUrl,
    adminToken: "",
  });
  const [connectionDraft, setConnectionDraft] = React.useState<StoredSettings>({
    baseUrl: initialBaseUrl,
    adminToken: "",
  });
  const [publicKey, setPublicKey] = React.useState<AuthaiPublicKey | null>(null);
  const [tools, setTools] = React.useState<McpTool[]>([]);
  const [resources, setResources] = React.useState<McpResource[]>([]);
  const [skills, setSkills] = React.useState<SkillEntry[]>([]);
  const [clients, setClients] = React.useState<ClientSummary[]>([]);
  const [namespaces, setNamespaces] = React.useState<NamespaceSummary[]>([]);
  const [kvItems, setKvItems] = React.useState<KvRecordSummary[]>([]);
  const [selectedValue, setSelectedValue] = React.useState<KvValueResponse | null>(null);
  const [selectedClientUuid, setSelectedClientUuid] = React.useState("");
  const [selectedNamespace, setSelectedNamespace] = React.useState("");
  const [selectedKey, setSelectedKey] = React.useState("");
  const [registerResult, setRegisterResult] = React.useState<RegisterClientResponse | null>(null);
  const [saveMessage, setSaveMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [registerForm, setRegisterForm] = React.useState({
    client_public_key: "",
    client_label: "",
    client_key_id: "",
    metadata: "",
  });
  const [kvForm, setKvForm] = React.useState({
    key: "",
    value: "{\n  \n}",
    metadata: "",
  });

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as StoredSettings;
      setConnection({
        baseUrl: parsed.baseUrl || window.location.origin,
        adminToken: parsed.adminToken || "",
      });
      setConnectionDraft({
        baseUrl: parsed.baseUrl || window.location.origin,
        adminToken: parsed.adminToken || "",
      });
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  async function refreshOverview(nextConnection: ConsoleConnection = connection) {
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const [publicKeyResponse, mcpResponse, skillsResponse] = await Promise.all([
        fetchAuthaiPublicKey(nextConnection),
        fetchMcpCatalog(nextConnection),
        fetchSkills(nextConnection),
      ]);

      setPublicKey(publicKeyResponse.authai_public_key);
      setTools(mcpResponse.tools);
      setResources(mcpResponse.resources);
      setSkills(skillsResponse.items);

      try {
        const clientsResponse = await fetchClients(nextConnection);
        setClients(clientsResponse.items);
        if (!selectedClientUuid && clientsResponse.items[0]) {
          setSelectedClientUuid(clientsResponse.items[0].client_uuid);
        }
      } catch (error) {
        setClients([]);
        setNamespaces([]);
        setKvItems([]);
        setSelectedValue(null);
        setStatusMessage(error instanceof Error ? error.message : "Unable to load admin data yet.");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load keyservice data.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void refreshOverview(connection);
  }, [connection.baseUrl, connection.adminToken]);

  React.useEffect(() => {
    if (!selectedClientUuid) {
      setNamespaces([]);
      setKvItems([]);
      setSelectedValue(null);
      return;
    }

    void (async () => {
      try {
        const response = await fetchNamespaces(connection, selectedClientUuid);
        setNamespaces(response.items);
        if (response.items.length > 0) {
          const firstNamespace = response.items[0]?.namespace ?? "";
          setSelectedNamespace((current) =>
            current && response.items.some((item) => item.namespace === current)
              ? current
              : firstNamespace,
          );
        } else {
          setSelectedNamespace("");
        }
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Unable to load namespaces.");
      }
    })();
  }, [connection, selectedClientUuid]);

  React.useEffect(() => {
    if (!selectedClientUuid || !selectedNamespace) {
      setKvItems([]);
      setSelectedValue(null);
      return;
    }

    void (async () => {
      try {
        const response = await fetchKvList(connection, selectedClientUuid, selectedNamespace);
        setKvItems(response.items);
        if (response.items.length > 0) {
          const firstKey = response.items[0]?.record_key ?? "";
          setSelectedKey((current) =>
            current && response.items.some((item) => item.record_key === current)
              ? current
              : firstKey,
          );
        } else {
          setSelectedKey("");
          setSelectedValue(null);
        }
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Unable to load key list.");
      }
    })();
  }, [connection, selectedClientUuid, selectedNamespace]);

  React.useEffect(() => {
    if (!selectedClientUuid || !selectedNamespace || !selectedKey) {
      setSelectedValue(null);
      return;
    }

    void (async () => {
      try {
        const response = await fetchKvValue(connection, selectedClientUuid, selectedNamespace, selectedKey);
        setSelectedValue(response);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Unable to load key value.");
      }
    })();
  }, [connection, selectedClientUuid, selectedNamespace, selectedKey]);

  function saveConnectionSettings() {
    const nextConnection = {
      baseUrl: connectionDraft.baseUrl.trim() || window.location.origin,
      adminToken: connectionDraft.adminToken.trim(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConnection));
    setConnection(nextConnection);
  }

  async function handleRegisterClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setRegisterResult(null);

    try {
      const response = await registerClient(connection, {
        client_public_key: registerForm.client_public_key,
        client_label: registerForm.client_label || undefined,
        client_key_id: registerForm.client_key_id || undefined,
        metadata: parseOptionalJson(registerForm.metadata),
      });
      setRegisterResult(response);
      const clientsResponse = await fetchClients(connection);
      setClients(clientsResponse.items);
      setSelectedClientUuid(response.client_uuid);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to register public key.");
    }
  }

  async function handleSaveKv(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClientUuid) {
      setErrorMessage("Choose a client before saving KV data.");
      return;
    }

    try {
      setErrorMessage("");
      const parsedValue = JSON.parse(kvForm.value);
      const parsedMetadata = parseOptionalJson(kvForm.metadata);
      const response = await savePlaintextKv(connection, selectedClientUuid, {
        namespace: selectedNamespace,
        items: [
          {
            key: kvForm.key,
            value: parsedValue,
            ...(parsedMetadata ? { metadata: parsedMetadata } : {}),
          },
        ],
      });
      setSaveMessage(`Saved ${response.saved_keys.join(", ")} in ${response.namespace}.`);
      const namespacesResponse = await fetchNamespaces(connection, selectedClientUuid);
      setNamespaces(namespacesResponse.items);
      const kvResponse = await fetchKvList(connection, selectedClientUuid, response.namespace);
      setSelectedNamespace(response.namespace);
      setKvItems(kvResponse.items);
      setSelectedKey(response.saved_keys[0] ?? "");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save KV data.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden bg-[linear-gradient(135deg,rgba(202,39,156,0.12),rgba(10,132,255,0.05)_48%,rgba(255,255,255,0.92)_100%)]">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <Badge className="border-transparent bg-white/70">MoloUI-aligned KeyService Console</Badge>
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    Browse MCP tools, skills, clients, and decrypted KV safely.
                  </h1>
                  <p className="max-w-3xl text-sm text-slate-600 sm:text-base">
                    The console stays on top of reusable backend APIs. Catalog browsing is public,
                    while manual client registration and plaintext KV inspection use the admin API.
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={() => void refreshOverview(connection)}
                disabled={loading}
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[24px] border border-white/60 bg-white/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Shield className="h-4 w-4 text-[color:var(--brand)]" />
                  AuthAI identity
                </div>
                <p className="text-xs text-slate-500">Current key id</p>
                <p className="mt-1 break-all text-sm font-medium">
                  {publicKey?.key_id ?? "Loading..."}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/60 bg-white/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Wrench className="h-4 w-4 text-[color:var(--system-blue)]" />
                  MCP tooling
                </div>
                <p className="text-2xl font-semibold">{tools.length}</p>
                <p className="text-xs text-slate-500">Tool contracts available to AI clients</p>
              </div>
              <div className="rounded-[24px] border border-white/60 bg-white/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="h-4 w-4 text-[color:var(--brand)]" />
                  Skills shipped
                </div>
                <p className="text-2xl font-semibold">{skills.length}</p>
                <p className="text-xs text-slate-500">Markdown skills discoverable by agents</p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Connection</h2>
              <p className="mt-1 text-sm text-slate-500">
                Point the console at any deployed keyservice instance and optionally provide the
                admin bearer token.
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="base-url">KeyService base URL</Label>
                <Input
                  id="base-url"
                  value={connectionDraft.baseUrl}
                  onChange={(event) =>
                    setConnectionDraft((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-token">Admin bearer token</Label>
                <Input
                  id="admin-token"
                  type="password"
                  value={connectionDraft.adminToken}
                  onChange={(event) =>
                    setConnectionDraft((current) => ({ ...current, adminToken: event.target.value }))
                  }
                  placeholder="Optional unless KEYSERVICE_BEARER_TOKEN is configured"
                />
              </div>
            </div>
            <Button onClick={saveConnectionSettings}>Apply connection</Button>
            {statusMessage ? (
              <p className="rounded-[20px] bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {statusMessage}
              </p>
            ) : null}
            {errorMessage ? (
              <p className="rounded-[20px] bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errorMessage}
              </p>
            ) : null}
            {saveMessage ? (
              <p className="rounded-[20px] bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {saveMessage}
              </p>
            ) : null}
          </div>
        </Card>
      </section>

      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="clients">Clients</TabsTrigger>
          <TabsTrigger value="kv">KV Admin</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog">
          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="space-y-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-[color:var(--system-blue)]" />
                <h2 className="text-lg font-semibold">MCP tools</h2>
              </div>
              <div className="grid gap-3">
                {tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-medium">{tool.name}</h3>
                        <p className="mt-1 text-sm text-slate-600">{tool.description}</p>
                      </div>
                      <Badge>{Object.keys(tool.inputSchema.properties ?? {}).length} inputs</Badge>
                    </div>
                    <pre className="mt-3 overflow-x-auto rounded-[20px] bg-slate-950 px-4 py-3 text-xs text-slate-100">
                      {formatJson(tool.inputSchema)}
                    </pre>
                  </div>
                ))}
              </div>
            </Card>

            <div className="grid gap-4">
              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <BookKey className="h-4 w-4 text-[color:var(--brand)]" />
                  <h2 className="text-lg font-semibold">MCP resources</h2>
                </div>
                <div className="space-y-3">
                  {resources.map((resource) => (
                    <div
                      key={resource.uri}
                      className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{resource.name}</span>
                        <Badge>{resource.mimeType}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{resource.description}</p>
                      <p className="mt-2 break-all text-xs text-slate-500">{resource.uri}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[color:var(--brand)]" />
                  <h2 className="text-lg font-semibold">Skills</h2>
                </div>
                <div className="space-y-3">
                  {skills.map((skill) => (
                    <details
                      key={skill.id}
                      className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4"
                    >
                      <summary className="list-none">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="font-medium">{skill.name}</h3>
                            <p className="mt-1 text-sm text-slate-600">{skill.description}</p>
                          </div>
                          <Badge>{skill.file_path}</Badge>
                        </div>
                      </summary>
                      <pre className="mt-3 overflow-x-auto rounded-[20px] bg-slate-950 px-4 py-3 text-xs text-slate-100">
                        {skill.body_markdown}
                      </pre>
                    </details>
                  ))}
                </div>
              </Card>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="clients">
          <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <Card>
              <form className="space-y-4" onSubmit={handleRegisterClient}>
                <div className="flex items-center gap-2">
                  <Fingerprint className="h-4 w-4 text-[color:var(--brand)]" />
                  <h2 className="text-lg font-semibold">Register public key</h2>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-public-key">Client public key PEM</Label>
                  <Textarea
                    id="client-public-key"
                    value={registerForm.client_public_key}
                    onChange={(event) =>
                      setRegisterForm((current) => ({
                        ...current,
                        client_public_key: event.target.value,
                      }))
                    }
                    placeholder="-----BEGIN PUBLIC KEY-----"
                    className="min-h-44"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="client-label">Client label</Label>
                    <Input
                      id="client-label"
                      value={registerForm.client_label}
                      onChange={(event) =>
                        setRegisterForm((current) => ({
                          ...current,
                          client_label: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="client-key-id">Client key id</Label>
                    <Input
                      id="client-key-id"
                      value={registerForm.client_key_id}
                      onChange={(event) =>
                        setRegisterForm((current) => ({
                          ...current,
                          client_key_id: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-metadata">Metadata JSON</Label>
                  <Textarea
                    id="client-metadata"
                    value={registerForm.metadata}
                    onChange={(event) =>
                      setRegisterForm((current) => ({
                        ...current,
                        metadata: event.target.value,
                      }))
                    }
                    placeholder='{"team":"ops"}'
                  />
                </div>
                <Button type="submit">Register client</Button>
              </form>
            </Card>

            <div className="grid gap-4">
              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-[color:var(--brand)]" />
                  <h2 className="text-lg font-semibold">AuthAI public key</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[24px] bg-[color:var(--surface-muted)]/80 p-4">
                    <p className="text-xs text-slate-500">Algorithm</p>
                    <p className="mt-1 text-sm font-medium">{publicKey?.algorithm ?? "Unknown"}</p>
                  </div>
                  <div className="rounded-[24px] bg-[color:var(--surface-muted)]/80 p-4">
                    <p className="text-xs text-slate-500">Fingerprint</p>
                    <p className="mt-1 break-all text-sm font-medium">
                      {publicKey?.public_key_fingerprint ?? "Unknown"}
                    </p>
                  </div>
                </div>
                <Textarea readOnly value={publicKey?.public_key_pem ?? ""} className="min-h-48" />
              </Card>

              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-[color:var(--system-blue)]" />
                  <h2 className="text-lg font-semibold">Latest registration result</h2>
                </div>
                {registerResult ? (
                  <pre className="overflow-x-auto rounded-[24px] bg-slate-950 px-4 py-4 text-xs text-slate-100">
                    {formatJson(registerResult)}
                  </pre>
                ) : (
                  <p className="text-sm text-slate-500">
                    Registering a client shows the returned challenge and client identifiers here.
                  </p>
                )}
              </Card>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="kv">
          <section className="grid gap-4 xl:grid-cols-[0.75fr_0.7fr_0.9fr]">
            <Card className="space-y-4">
              <div className="flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-[color:var(--brand)]" />
                <h2 className="text-lg font-semibold">Clients</h2>
              </div>
              <div className="space-y-3">
                {clients.map((client) => (
                  <button
                    key={client.client_uuid}
                    type="button"
                    onClick={() => setSelectedClientUuid(client.client_uuid)}
                    className={`w-full rounded-[24px] border px-4 py-4 text-left ${
                      selectedClientUuid === client.client_uuid
                        ? "border-[color:var(--brand)] bg-white"
                        : "border-[color:var(--border)] bg-[color:var(--surface-muted)]/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{client.client_label || client.client_uuid}</p>
                        <p className="mt-1 break-all text-xs text-slate-500">
                          {client.public_key_fingerprint}
                        </p>
                      </div>
                      <Badge>{client.kv_count} keys</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span>{client.namespace_count} namespaces</span>
                      <span>Updated {formatDate(client.last_activity_at)}</span>
                    </div>
                  </button>
                ))}
                {clients.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No admin-visible clients yet. Add the admin token and register a client first.
                  </p>
                ) : null}
              </div>
            </Card>

            <div className="grid gap-4">
              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <BookKey className="h-4 w-4 text-[color:var(--system-blue)]" />
                  <h2 className="text-lg font-semibold">Namespaces</h2>
                </div>
                <div className="space-y-3">
                  {namespaces.map((namespace) => (
                    <button
                      key={namespace.namespace}
                      type="button"
                      onClick={() => setSelectedNamespace(namespace.namespace)}
                      className={`w-full rounded-[24px] border px-4 py-4 text-left ${
                        selectedNamespace === namespace.namespace
                          ? "border-[color:var(--brand)] bg-white"
                          : "border-[color:var(--border)] bg-[color:var(--surface-muted)]/70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{namespace.namespace}</span>
                        <Badge>{namespace.key_count} keys</Badge>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Updated {formatDate(namespace.last_updated_at)}
                      </p>
                    </button>
                  ))}
                </div>
              </Card>

              <Card>
                <form className="space-y-4" onSubmit={handleSaveKv}>
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-[color:var(--brand)]" />
                    <h2 className="text-lg font-semibold">Manual KV save</h2>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="selected-namespace">Namespace</Label>
                    <Input
                      id="selected-namespace"
                      value={selectedNamespace}
                      onChange={(event) => setSelectedNamespace(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manual-key">Key name</Label>
                    <Input
                      id="manual-key"
                      value={kvForm.key}
                      onChange={(event) =>
                        setKvForm((current) => ({ ...current, key: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manual-value">Value JSON</Label>
                    <Textarea
                      id="manual-value"
                      value={kvForm.value}
                      onChange={(event) =>
                        setKvForm((current) => ({ ...current, value: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manual-metadata">Metadata JSON</Label>
                    <Textarea
                      id="manual-metadata"
                      value={kvForm.metadata}
                      onChange={(event) =>
                        setKvForm((current) => ({ ...current, metadata: event.target.value }))
                      }
                      placeholder='{"source":"console"}'
                    />
                  </div>
                  <Button type="submit">Save KV</Button>
                </form>
              </Card>
            </div>

            <div className="grid gap-4">
              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <BookKey className="h-4 w-4 text-[color:var(--system-blue)]" />
                  <h2 className="text-lg font-semibold">Key list</h2>
                </div>
                <div className="space-y-3">
                  {kvItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedKey(item.record_key)}
                      className={`w-full rounded-[24px] border px-4 py-4 text-left ${
                        selectedKey === item.record_key
                          ? "border-[color:var(--brand)] bg-white"
                          : "border-[color:var(--border)] bg-[color:var(--surface-muted)]/70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{item.record_key}</span>
                        <Badge>{formatDate(item.updated_at)}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Fingerprint {item.value_fingerprint.slice(0, 18)}...
                      </p>
                    </button>
                  ))}
                  {kvItems.length === 0 ? (
                    <p className="text-sm text-slate-500">Choose a client and namespace to browse KV keys.</p>
                  ) : null}
                </div>
              </Card>

              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[color:var(--brand)]" />
                  <h2 className="text-lg font-semibold">Value inspector</h2>
                </div>
                {selectedValue ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[24px] bg-[color:var(--surface-muted)]/80 p-4">
                        <p className="text-xs text-slate-500">Namespace</p>
                        <p className="mt-1 text-sm font-medium">{selectedValue.namespace}</p>
                      </div>
                      <div className="rounded-[24px] bg-[color:var(--surface-muted)]/80 p-4">
                        <p className="text-xs text-slate-500">Key</p>
                        <p className="mt-1 text-sm font-medium">{selectedValue.key}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Value</Label>
                      <Textarea readOnly value={formatJson(selectedValue.value)} className="min-h-52" />
                    </div>
                    <div className="space-y-2">
                      <Label>Metadata</Label>
                      <Textarea
                        readOnly
                        value={formatJson(selectedValue.metadata)}
                        className="min-h-36"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    Pick a key from the list to inspect its decrypted JSON value.
                  </p>
                )}
              </Card>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </main>
  );
}
