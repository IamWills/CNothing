"use client";

import * as React from "react";
import { BookKey, Fingerprint, KeyRound, Sparkles } from "lucide-react";
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
  fetchClients,
  fetchKvList,
  fetchKvValue,
  fetchNamespaces,
  savePlaintextKv,
  type ClientSummary,
  type KvRecordSummary,
  type KvValueResponse,
  type NamespaceSummary,
} from "@/lib/api";
import { clientChannelTabs } from "@/lib/channel-tabs";
import { formatDate, formatJson, parseOptionalJson } from "@/lib/console-utils";

export function KvPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [clients, setClients] = React.useState<ClientSummary[]>([]);
  const [namespaces, setNamespaces] = React.useState<NamespaceSummary[]>([]);
  const [kvItems, setKvItems] = React.useState<KvRecordSummary[]>([]);
  const [selectedValue, setSelectedValue] = React.useState<KvValueResponse | null>(null);
  const [selectedClientUuid, setSelectedClientUuid] = React.useState("");
  const [selectedNamespace, setSelectedNamespace] = React.useState("");
  const [selectedKey, setSelectedKey] = React.useState("");
  const [saveMessage, setSaveMessage] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [kvForm, setKvForm] = React.useState({
    key: "",
    value: "{\n  \n}",
    metadata: "",
  });

  const refreshClients = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    setSaveMessage("");

    try {
      const response = await fetchClients(connection);
      setClients(response.items);
      setSelectedClientUuid((current) =>
        current && response.items.some((item) => item.client_uuid === current)
          ? current
          : (response.items[0]?.client_uuid ?? ""),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load clients.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refreshClients();
  }, [refreshClients]);

  React.useEffect(() => {
    if (!selectedClientUuid) {
      setNamespaces([]);
      setSelectedNamespace("");
      setKvItems([]);
      setSelectedKey("");
      setSelectedValue(null);
      return;
    }

    void (async () => {
      try {
        const response = await fetchNamespaces(connection, selectedClientUuid);
        setNamespaces(response.items);
        setSelectedNamespace((current) =>
          current && response.items.some((item) => item.namespace === current)
            ? current
            : (response.items[0]?.namespace ?? ""),
        );
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to load namespaces.");
      }
    })();
  }, [connection, selectedClientUuid]);

  React.useEffect(() => {
    if (!selectedClientUuid || !selectedNamespace) {
      setKvItems([]);
      setSelectedKey("");
      setSelectedValue(null);
      return;
    }

    void (async () => {
      try {
        const response = await fetchKvList(connection, selectedClientUuid, selectedNamespace);
        setKvItems(response.items);
        setSelectedKey((current) =>
          current && response.items.some((item) => item.record_key === current)
            ? current
            : (response.items[0]?.record_key ?? ""),
        );
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to load key list.");
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
        setErrorMessage(error instanceof Error ? error.message : "Unable to load key value.");
      }
    })();
  }, [connection, selectedClientUuid, selectedNamespace, selectedKey]);

  async function handleSaveKv(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClientUuid) {
      setErrorMessage("Choose a client before saving KV data.");
      return;
    }

    try {
      setErrorMessage("");
      setSaveMessage("");
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
    <PageFrame
      title="Clients"
      description="Browse client namespaces, inspect saved key names and values, and add new KV records without leaving the Clients channel."
      actions={
        <>
          <ReloadIconButton onReload={() => void refreshClients()} disabled={loading} />
          <ChannelRouteTabs items={clientChannelTabs} />
        </>
      }
    >
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
        errorMessage={errorMessage}
        successMessage={saveMessage}
      />

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
                <p className="text-sm text-slate-500">
                  Choose a client and namespace to browse KV keys.
                </p>
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
    </PageFrame>
  );
}
