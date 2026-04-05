"use client";

import * as React from "react";
import { Fingerprint, KeyRound, RefreshCcw, Shield } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { PageFrame } from "@/components/layout/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import {
  fetchAuthaiPublicKey,
  fetchClients,
  registerClient,
  type AuthaiPublicKey,
  type ClientSummary,
  type RegisterClientResponse,
} from "@/lib/api";
import { formatDate, formatJson, parseOptionalJson } from "@/lib/console-utils";

export function ClientsPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [publicKey, setPublicKey] = React.useState<AuthaiPublicKey | null>(null);
  const [clients, setClients] = React.useState<ClientSummary[]>([]);
  const [registerResult, setRegisterResult] = React.useState<RegisterClientResponse | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [registerForm, setRegisterForm] = React.useState({
    client_public_key: "",
    client_label: "",
    client_key_id: "",
    metadata: "",
  });

  const refreshClients = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const [publicKeyResponse, clientsResponse] = await Promise.all([
        fetchAuthaiPublicKey(connection),
        fetchClients(connection),
      ]);
      setPublicKey(publicKeyResponse.authai_public_key);
      setClients(clientsResponse.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load client data.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refreshClients();
  }, [refreshClients]);

  async function handleRegisterClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setRegisterResult(null);

    try {
      const response = await registerClient(connection, {
        client_public_key: registerForm.client_public_key,
        client_label: registerForm.client_label || undefined,
        client_key_id: registerForm.client_key_id || undefined,
        metadata: parseOptionalJson(registerForm.metadata),
      });
      setRegisterResult(response);
      setStatusMessage(`Registered client ${response.client_uuid}.`);
      const clientsResponse = await fetchClients(connection);
      setClients(clientsResponse.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to register public key.");
    }
  }

  return (
    <PageFrame
      title="Clients"
      description="Register client public keys manually and review the identities that can access CNothing."
      actions={
        <Button variant="secondary" onClick={() => void refreshClients()} disabled={loading}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
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

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-[color:var(--brand)]" />
          <h2 className="text-lg font-semibold">Registered clients</h2>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {clients.map((client) => (
            <div
              key={client.client_uuid}
              className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{client.client_label || client.client_uuid}</p>
                  <p className="mt-1 break-all text-xs text-slate-500">
                    {client.public_key_fingerprint}
                  </p>
                </div>
                <Badge>{client.kv_count} keys</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                <span>{client.namespace_count} namespaces</span>
                <span>Updated {formatDate(client.last_activity_at)}</span>
              </div>
            </div>
          ))}
          {clients.length === 0 ? (
            <p className="text-sm text-slate-500">
              No admin-visible clients yet. Add the admin token and register a client first.
            </p>
          ) : null}
        </div>
      </Card>
    </PageFrame>
  );
}
