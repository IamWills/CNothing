"use client";

import * as React from "react";
import { Layers, Plug, Zap } from "lucide-react";
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
  fetchV2Capabilities,
  fetchV2Connectors,
  registerV2Capability,
  registerV2Connector,
  type V2Capability,
  type V2Connector,
} from "@/lib/api-v2";
import { v2ChannelTabs } from "@/lib/v2-channel-tabs";
import { parseOptionalJson } from "@/lib/console-utils";

export function CapabilitiesPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [connectors, setConnectors] = React.useState<V2Connector[]>([]);
  const [capabilities, setCapabilities] = React.useState<V2Capability[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [connectorForm, setConnectorForm] = React.useState({
    provider: "github",
    display_name: "GitHub Connector",
    callback_url: "http://127.0.0.1:3030",
  });
  const [capabilityForm, setCapabilityForm] = React.useState({
    connector_id: "",
    name: "github.create_issue",
    description: "Create a GitHub issue",
    capability_type: "ACTION",
    risk_level: "LOW",
    scopes: '["repo.issue.write"]',
  });

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const [connectorResponse, capabilityResponse] = await Promise.all([
        fetchV2Connectors(connection),
        fetchV2Capabilities(connection),
      ]);
      setConnectors(connectorResponse.items);
      setCapabilities(capabilityResponse.items);
      if (!capabilityForm.connector_id && connectorResponse.items[0]?.id) {
        setCapabilityForm((prev) => ({ ...prev, connector_id: connectorResponse.items[0]!.id }));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load capabilities.");
    } finally {
      setLoading(false);
    }
  }, [connection, capabilityForm.connector_id]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRegisterConnector(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
      await registerV2Connector(connection, connectorForm);
      setStatusMessage(`Registered connector ${connectorForm.display_name}.`);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Connector registration failed.");
    }
  }

  async function handleRegisterCapability(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    try {
      await registerV2Capability(connection, {
        connector_id: capabilityForm.connector_id,
        name: capabilityForm.name,
        description: capabilityForm.description,
        capability_type: capabilityForm.capability_type,
        risk_level: capabilityForm.risk_level,
        scopes: parseOptionalJson(capabilityForm.scopes),
      });
      setStatusMessage(`Registered capability ${capabilityForm.name}.`);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Capability registration failed.");
    }
  }

  return (
    <PageFrame
      title="Capabilities"
      description="Register connectors and declare business capabilities. Agents invoke capabilities — never credentials."
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

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Register connector</h2>
          </div>
          <form className="space-y-4" onSubmit={(event) => void handleRegisterConnector(event)}>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Input
                value={connectorForm.provider}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, provider: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Display name</Label>
              <Input
                value={connectorForm.display_name}
                onChange={(event) =>
                  setConnectorForm((prev) => ({ ...prev, display_name: event.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Callback URL</Label>
              <Input
                value={connectorForm.callback_url}
                onChange={(event) =>
                  setConnectorForm((prev) => ({ ...prev, callback_url: event.target.value }))
                }
                required
              />
            </div>
            <Button type="submit" className="w-full">
              Register connector
            </Button>
          </form>
        </Card>

        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Register capability</h2>
          </div>
          <form className="space-y-4" onSubmit={(event) => void handleRegisterCapability(event)}>
            <div className="space-y-2">
              <Label>Connector</Label>
              <select
                className="w-full rounded-md border border-[color:var(--border)] bg-white px-3 py-2 text-sm"
                value={capabilityForm.connector_id}
                onChange={(event) =>
                  setCapabilityForm((prev) => ({ ...prev, connector_id: event.target.value }))
                }
                required
              >
                <option value="">Select connector</option>
                {connectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.display_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Capability name</Label>
              <Input
                value={capabilityForm.name}
                onChange={(event) => setCapabilityForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={capabilityForm.description}
                onChange={(event) =>
                  setCapabilityForm((prev) => ({ ...prev, description: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <select
                  className="w-full rounded-md border border-[color:var(--border)] bg-white px-3 py-2 text-sm"
                  value={capabilityForm.capability_type}
                  onChange={(event) =>
                    setCapabilityForm((prev) => ({ ...prev, capability_type: event.target.value }))
                  }
                >
                  <option value="ACTION">ACTION</option>
                  <option value="QUERY">QUERY</option>
                  <option value="CONFIDENTIAL_QUERY">CONFIDENTIAL_QUERY</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Risk level</Label>
                <select
                  className="w-full rounded-md border border-[color:var(--border)] bg-white px-3 py-2 text-sm"
                  value={capabilityForm.risk_level}
                  onChange={(event) =>
                    setCapabilityForm((prev) => ({ ...prev, risk_level: event.target.value }))
                  }
                >
                  {["PUBLIC", "LOW", "MEDIUM", "HIGH", "CONFIDENTIAL"].map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Scopes (JSON array)</Label>
              <Textarea
                value={capabilityForm.scopes}
                onChange={(event) => setCapabilityForm((prev) => ({ ...prev, scopes: event.target.value }))}
              />
            </div>
            <Button type="submit" className="w-full">
              Register capability
            </Button>
          </form>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b px-6 py-4">
            <div className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Connectors</h2>
            </div>
          </div>
          <div className="divide-y">
            {connectors.map((connector) => (
              <div key={connector.id} className="space-y-1 px-6 py-4">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{connector.display_name}</p>
                  <Badge>{connector.status}</Badge>
                </div>
                <p className="text-sm text-slate-600">{connector.provider}</p>
                <p className="font-mono text-xs text-slate-500">{connector.callback_url}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b px-6 py-4">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Capability registry</h2>
            </div>
          </div>
          <div className="divide-y">
            {capabilities.map((capability) => (
              <div key={capability.id} className="space-y-2 px-6 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{capability.display_name ?? capability.name}</p>
                  <Badge>{capability.capability_type}</Badge>
                  <Badge>{capability.risk_level}</Badge>
                  {capability.source ? <Badge variant="secondary">{capability.source}</Badge> : null}
                  {capability.invocation_type ? (
                    <Badge variant="outline">{capability.invocation_type}</Badge>
                  ) : null}
                  {capability.connection_required ? (
                    <Badge variant="outline">connection required</Badge>
                  ) : null}
                </div>
                <p className="font-mono text-xs text-slate-500">{capability.name}</p>
                <p className="text-sm text-slate-600">{capability.description}</p>
                <p className="text-xs text-slate-500">Scopes: {capability.scopes.join(", ") || "none"}</p>
                {capability.provider_id ? (
                  <p className="font-mono text-xs text-slate-400">
                    provider {capability.provider_id.slice(0, 8)}…
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PageFrame>
  );
}
