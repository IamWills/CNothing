"use client";

import * as React from "react";
import { ArrowRightLeft, Database, FileText } from "lucide-react";
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
  fetchKvInventory,
  fetchMigrationGuide,
  fetchPlatformStatus,
  migrateKvToCredential,
  fetchV2Connectors,
  type V2KvInventoryItem,
} from "@/lib/api-v2";
import { clientChannelTabs } from "@/lib/channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function MigrationPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [inventory, setInventory] = React.useState<V2KvInventoryItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [sunsetAt, setSunsetAt] = React.useState("");
  const [guideSteps, setGuideSteps] = React.useState<string[]>([]);
  const [connectorOptions, setConnectorOptions] = React.useState<Array<{ id: string; display_name: string }>>([]);
  const [selected, setSelected] = React.useState<V2KvInventoryItem | null>(null);
  const [form, setForm] = React.useState({
    connector_id: "",
    owner_user_id: "user123",
  });
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const [statusResponse, guideResponse, inventoryResponse, connectorsResponse] = await Promise.all([
        fetchPlatformStatus(connection),
        fetchMigrationGuide(connection),
        fetchKvInventory(connection),
        fetchV2Connectors(connection),
      ]);
      setSunsetAt(statusResponse.v1.sunset_at);
      setGuideSteps(guideResponse.guide.steps);
      setInventory(inventoryResponse.items);
      setTotal(inventoryResponse.total);
      setConnectorOptions(
        connectorsResponse.items.map((item) => ({ id: item.id, display_name: item.display_name })),
      );
      setForm((prev) => ({
        ...prev,
        connector_id: prev.connector_id || connectorsResponse.items[0]?.id || "",
      }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load migration data.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleMigrate(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) {
      setErrorMessage("Select a KV record to migrate.");
      return;
    }

    setErrorMessage("");
    setStatusMessage("");
    setLoading(true);
    try {
      const response = await migrateKvToCredential(connection, {
        client_uuid: selected.client_uuid,
        namespace: selected.namespace,
        record_key: selected.record_key,
        connector_id: form.connector_id,
        owner_user_id: form.owner_user_id,
      });
      setStatusMessage(
        `Migrated ${selected.namespace}/${selected.record_key} → credential ${String(response.migration.credential_id ?? "")}`,
      );
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Migration failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageFrame
      title="v1 → v2 Migration"
      description="Inventory legacy KV records and migrate secrets into connector-held credentials. v1 AuthAI/KV APIs are deprecated."
    >
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
      />

      <ChannelRouteTabs items={clientChannelTabs} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-amber-300 bg-amber-50 text-amber-900">
            v1 sunset: {sunsetAt || "—"}
          </Badge>
          <Badge>{total} KV records</Badge>
        </div>
        <ReloadIconButton onReload={() => void refresh()} disabled={loading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Migration guide</h2>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            {guideSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Card>

        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Migrate selected record</h2>
          </div>
          {selected ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p>
                <strong>{selected.namespace}</strong> / {selected.record_key}
              </p>
              <p className="text-slate-600">Client: {selected.client_uuid}</p>
              {selected.suggested_capability ? (
                <p className="text-slate-600">Suggested: {selected.suggested_capability}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-600">Select a record from the inventory table.</p>
          )}
          <form className="space-y-4" onSubmit={(event) => void handleMigrate(event)}>
            <div className="space-y-2">
              <Label htmlFor="connector-id">Connector</Label>
              <select
                id="connector-id"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                value={form.connector_id}
                onChange={(event) => setForm((prev) => ({ ...prev, connector_id: event.target.value }))}
                required
              >
                {connectorOptions.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.display_name} ({connector.id.slice(0, 8)}…)
                  </option>
                ))}
              </select>
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
            <Button type="submit" disabled={loading || !selected}>
              Migrate to credential
            </Button>
          </form>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-6 py-4">
          <Database className="h-5 w-5 text-[color:var(--brand)]" />
          <h2 className="text-lg font-semibold">KV inventory</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3">Namespace</th>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Suggested capability</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((item) => (
                <tr key={`${item.client_uuid}:${item.namespace}:${item.record_key}`} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">{item.namespace}</td>
                  <td className="px-4 py-3">{item.record_key}</td>
                  <td className="px-4 py-3 font-mono text-xs">{item.client_uuid.slice(0, 8)}…</td>
                  <td className="px-4 py-3">{item.suggested_capability ?? "—"}</td>
                  <td className="px-4 py-3">{formatDate(item.updated_at)}</td>
                  <td className="px-4 py-3">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelected(item)}
                    >
                      Select
                    </Button>
                  </td>
                </tr>
              ))}
              {inventory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No KV records found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </PageFrame>
  );
}
