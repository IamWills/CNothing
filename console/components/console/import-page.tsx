"use client";

import * as React from "react";
import { FileUp, Layers, Sparkles } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import {
  activateMcpCapabilities,
  activateOpenApiCapabilities,
  fetchOAuthProviders,
  importMcpManifestSpec,
  importOpenApiSpec,
  type V25ImportCandidate,
  type V25ImportJob,
  type V25OAuthProvider,
} from "@/lib/api-v2";
import { v2ChannelTabs } from "@/lib/v2-channel-tabs";

type ImportMode = "openapi" | "mcp";

function candidateKey(candidate: V25ImportCandidate): string {
  return candidate.name;
}

export function ImportPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [mode, setMode] = React.useState<ImportMode>("openapi");
  const [providers, setProviders] = React.useState<V25OAuthProvider[]>([]);
  const [job, setJob] = React.useState<V25ImportJob | null>(null);
  const [selectedNames, setSelectedNames] = React.useState<string[]>([]);
  const [providerId, setProviderId] = React.useState("");
  const [providerSlug, setProviderSlug] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [openApiForm, setOpenApiForm] = React.useState({
    url: "",
    content: "",
    filename: "openapi.json",
    provider_slug: "",
  });
  const [mcpForm, setMcpForm] = React.useState({
    server_url: "",
    provider_slug: "",
    manifest: '{\n  "tools": [\n    {\n      "name": "search",\n      "description": "Search documents",\n      "inputSchema": { "type": "object" }\n    }\n  ]\n}',
  });

  const refreshProviders = React.useCallback(async () => {
    try {
      const response = await fetchOAuthProviders(connection);
      setProviders(response.items);
    } catch {
      /* providers are optional for import preview */
    }
  }, [connection]);

  React.useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  React.useEffect(() => {
    if (!job?.candidates.length) {
      setSelectedNames([]);
      return;
    }
    setSelectedNames(job.candidates.map((candidate) => candidateKey(candidate)));
  }, [job]);

  async function handleImport(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setLoading(true);
    setJob(null);
    try {
      if (mode === "openapi") {
        if (!openApiForm.url.trim() && !openApiForm.content.trim()) {
          throw new Error("Paste OpenAPI JSON or provide a URL.");
        }
        const response = await importOpenApiSpec(connection, {
          url: openApiForm.url.trim() || undefined,
          content: openApiForm.content.trim() || undefined,
          filename: openApiForm.filename.trim() || undefined,
          provider_slug: openApiForm.provider_slug.trim() || undefined,
          provider_id: providerId || undefined,
        });
        setJob(response.job);
        if (response.job.status === "failed") {
          throw new Error(response.job.error_message ?? "OpenAPI import failed.");
        }
        setStatusMessage(`Parsed ${response.job.candidate_count} OpenAPI operations.`);
      } else {
        const manifest = JSON.parse(mcpForm.manifest) as Record<string, unknown>;
        if (mcpForm.server_url.trim()) {
          manifest.server_url = mcpForm.server_url.trim();
        }
        const response = await importMcpManifestSpec(connection, {
          manifest,
          provider_slug: mcpForm.provider_slug.trim() || undefined,
          provider_id: providerId || undefined,
        });
        setJob(response.job);
        if (response.job.status === "failed") {
          throw new Error(response.job.error_message ?? "MCP import failed.");
        }
        setStatusMessage(`Parsed ${response.job.candidate_count} MCP tools.`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleActivate() {
    if (!job) {
      return;
    }
    setErrorMessage("");
    setStatusMessage("");
    setLoading(true);
    try {
      const payload = {
        job_id: job.id,
        candidate_names: selectedNames,
        provider_id: providerId || undefined,
        provider_slug: providerSlug.trim() || undefined,
      };
      const response =
        job.import_type === "mcp"
          ? await activateMcpCapabilities(connection, payload)
          : await activateOpenApiCapabilities(connection, payload);
      setStatusMessage(`Activated ${response.activated} capabilities via the gateway connector.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Activation failed.");
    } finally {
      setLoading(false);
    }
  }

  function toggleCandidate(name: string) {
    setSelectedNames((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
    );
  }

  return (
    <PageFrame
      title="Import Capabilities"
      description="Upload OpenAPI specs or MCP tool manifests. Capabilities bind to OAuth providers and activate through the built-in gateway — no custom connector required."
      actions={
        <>
          <ReloadIconButton onReload={() => void refreshProviders()} disabled={loading} />
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

      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === "openapi" ? "default" : "outline"}
          onClick={() => setMode("openapi")}
        >
          <FileUp className="mr-2 h-4 w-4" />
          OpenAPI
        </Button>
        <Button
          type="button"
          variant={mode === "mcp" ? "default" : "outline"}
          onClick={() => setMode("mcp")}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          MCP
        </Button>
      </div>

      <Card className="p-5">
        <form className="space-y-4" onSubmit={(event) => void handleImport(event)}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="provider-select">OAuth provider (optional)</Label>
              <select
                id="provider-select"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                value={providerId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setProviderId(nextId);
                  const provider = providers.find((item) => item.id === nextId);
                  setProviderSlug(provider?.slug ?? "");
                }}
              >
                <option value="">No provider binding</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.display_name} ({provider.slug})
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                When selected, activated capabilities require a user OAuth connection before invoke.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-slug">Capability name prefix</Label>
              <Input
                id="provider-slug"
                placeholder={mode === "openapi" ? "github" : "notion_mcp"}
                value={mode === "openapi" ? openApiForm.provider_slug : mcpForm.provider_slug}
                onChange={(event) =>
                  mode === "openapi"
                    ? setOpenApiForm((prev) => ({ ...prev, provider_slug: event.target.value }))
                    : setMcpForm((prev) => ({ ...prev, provider_slug: event.target.value }))
                }
              />
            </div>
          </div>

          {mode === "openapi" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="openapi-url">OpenAPI URL</Label>
                <Input
                  id="openapi-url"
                  placeholder="https://api.example.com/openapi.json"
                  value={openApiForm.url}
                  onChange={(event) =>
                    setOpenApiForm((prev) => ({ ...prev, url: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="openapi-content">Or paste OpenAPI JSON</Label>
                <Textarea
                  id="openapi-content"
                  rows={8}
                  placeholder='{"openapi":"3.0.0","paths":{...}}'
                  value={openApiForm.content}
                  onChange={(event) =>
                    setOpenApiForm((prev) => ({ ...prev, content: event.target.value }))
                  }
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="mcp-server-url">MCP server URL</Label>
                <Input
                  id="mcp-server-url"
                  placeholder="https://mcp.example.com/sse"
                  value={mcpForm.server_url}
                  onChange={(event) =>
                    setMcpForm((prev) => ({ ...prev, server_url: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-manifest">MCP manifest JSON</Label>
                <Textarea
                  id="mcp-manifest"
                  rows={10}
                  value={mcpForm.manifest}
                  onChange={(event) =>
                    setMcpForm((prev) => ({ ...prev, manifest: event.target.value }))
                  }
                />
              </div>
            </>
          )}

          <Button type="submit" disabled={loading}>
            {loading ? "Importing..." : "Preview candidates"}
          </Button>
        </form>
      </Card>

      {job?.candidates.length ? (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-[#ca279c]" />
                <h3 className="font-semibold">Import job {job.id.slice(0, 8)}</h3>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {job.candidate_count} candidates · status {job.status}
              </p>
            </div>
            <Button type="button" disabled={loading || selectedNames.length === 0} onClick={() => void handleActivate()}>
              Activate selected ({selectedNames.length})
            </Button>
          </div>

          <div className="space-y-2">
            {job.candidates.map((candidate) => {
              const name = candidateKey(candidate);
              const checked = selectedNames.includes(name);
              return (
                <label
                  key={name}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() => toggleCandidate(name)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{candidate.display_name || name}</span>
                      <Badge variant="outline">{candidate.capability_type}</Badge>
                      <Badge variant="outline">{candidate.risk_level}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{candidate.description || name}</p>
                    {candidate.invocation_config ? (
                      <p className="mt-1 truncate font-mono text-xs text-slate-500">
                        {JSON.stringify(candidate.invocation_config)}
                      </p>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>
        </Card>
      ) : null}
    </PageFrame>
  );
}
