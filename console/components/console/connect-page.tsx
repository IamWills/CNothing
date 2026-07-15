"use client";

import * as React from "react";
import { Copy, ExternalLink, Link2, MonitorSmartphone, Plus } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import {
  fetchV4Providers,
  pollV4DeviceFlow,
  startV4DeviceFlow,
  startV4OAuthConnect,
  type V4OAuthProvider,
} from "@/lib/api-v4";

type DeviceSessionState = {
  providerSlug: string;
  providerName: string;
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresAt: string;
  pollIntervalMs: number;
  status: "pending" | "completed" | "expired" | "denied";
  connectionId?: string;
};

export function ConnectPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { isLoggedIn } = useUserSession();
  const [providers, setProviders] = React.useState<V4OAuthProvider[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [deviceSession, setDeviceSession] = React.useState<DeviceSessionState | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchV4Providers(connection);
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

  React.useEffect(() => {
    if (!deviceSession || deviceSession.status !== "pending") {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await pollV4DeviceFlow(connection, deviceSession.sessionId);
        if (cancelled) return;

        if (result.status === "completed") {
          setDeviceSession((prev) =>
            prev
              ? {
                  ...prev,
                  status: "completed",
                  ...(result.connection_id ? { connectionId: result.connection_id } : {}),
                }
              : null,
          );
          setStatusMessage("Device authorization complete. Connection saved in Vault.");
          return;
        }

        if (result.status === "expired" || result.status === "denied") {
          setDeviceSession((prev) => (prev ? { ...prev, status: result.status } : null));
          setErrorMessage(
            result.status === "denied"
              ? "Device authorization was denied."
              : "Device authorization expired. Start again.",
          );
          return;
        }

        setDeviceSession((prev) =>
          prev
            ? {
                ...prev,
                pollIntervalMs: (result.poll_interval_seconds ?? prev.pollIntervalMs / 1000) * 1000,
              }
            : null,
        );
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Device flow poll failed.");
        }
      }
    }, deviceSession.pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connection, deviceSession]);

  async function handleConnect(provider: V4OAuthProvider) {
    if (!isLoggedIn) {
      setErrorMessage("Sign in first from the Login page.");
      return;
    }
    setErrorMessage("");
    setStatusMessage("");
    setDeviceSession(null);
    try {
      const redirectAfter =
        typeof window !== "undefined" ? `${window.location.origin}/connections` : undefined;
      const response = await startV4OAuthConnect(connection, {
        provider_slug: provider.slug,
        ...(redirectAfter ? { redirect_after: redirectAfter } : {}),
      });
      window.location.href = response.authorization_url;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to start OAuth flow.");
    }
  }

  async function handleDeviceConnect(provider: V4OAuthProvider) {
    if (!isLoggedIn) {
      setErrorMessage("Sign in first from the Login page.");
      return;
    }
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await startV4DeviceFlow(connection, { provider_slug: provider.slug });
      setDeviceSession({
        providerSlug: provider.slug,
        providerName: provider.display_name,
        sessionId: response.session_id,
        userCode: response.user_code,
        verificationUri: response.verification_uri,
        verificationUriComplete: response.verification_uri_complete,
        expiresAt: response.expires_at,
        pollIntervalMs: response.poll_interval_seconds * 1000,
        status: "pending",
      });
      setStatusMessage(
        `Open the verification page and enter code ${response.user_code}. CNothing will poll until authorized.`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to start device flow.");
    }
  }

  async function copyUserCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setStatusMessage("User code copied to clipboard.");
    } catch {
      setStatusMessage("Copy the user code manually.");
    }
  }

  return (
    <PageFrame
      title="Connect Providers"
      description="Connect OAuth2/OIDC providers once. Tokens stay in CNothing Vault — agents never receive them."
      actions={<ReloadIconButton disabled={loading} onReload={() => void refresh()} />}
    >
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
      />

      {deviceSession ? (
        <Card className="border-[#ca279c]/30 bg-[#fdf5fb] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <MonitorSmartphone className="h-5 w-5 text-[#ca279c]" />
                <h3 className="text-lg font-semibold">Device authorization</h3>
                <Badge>{deviceSession.providerName}</Badge>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Visit the verification page, sign in, and enter this code. CNothing polls in the
                background — no redirect required.
              </p>
            </div>
            <Button variant="secondary" onClick={() => setDeviceSession(null)}>
              Dismiss
            </Button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[auto_1fr]">
            <div className="rounded-xl border bg-white px-6 py-4 text-center">
              <p className="text-xs uppercase tracking-wide text-slate-500">User code</p>
              <p className="mt-2 font-mono text-3xl font-bold tracking-widest text-slate-900">
                {deviceSession.userCode}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => void copyUserCode(deviceSession.userCode)}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy code
              </Button>
            </div>

            <div className="space-y-3 text-sm">
              <p>
                <span className="font-medium text-slate-700">Status:</span>{" "}
                {deviceSession.status === "pending" ? "Waiting for authorization…" : deviceSession.status}
              </p>
              <p className="text-slate-600">Expires: {new Date(deviceSession.expiresAt).toLocaleString()}</p>
              {deviceSession.connectionId ? (
                <p className="font-mono text-xs text-emerald-700">
                  Connection {deviceSession.connectionId.slice(0, 12)}… saved to Vault
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <a
                  href={deviceSession.verificationUriComplete ?? deviceSession.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[color:var(--brand)] px-4 text-sm font-medium text-white"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open verification page
                </a>
                {deviceSession.status === "completed" ? (
                  <a
                    href="/connections"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 text-sm font-medium"
                  >
                    View connections
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
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
                  {provider.supports_device_flow ? (
                    <Badge variant="outline">Device flow</Badge>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  disabled={!provider.connectable || !isLoggedIn}
                  onClick={() => void handleConnect(provider)}
                >
                  Connect
                </Button>
                {provider.supports_device_flow && provider.connectable ? (
                  <Button
                    variant="secondary"
                    disabled={!isLoggedIn}
                    onClick={() => void handleDeviceConnect(provider)}
                  >
                    Device code
                  </Button>
                ) : null}
              </div>
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
          Register and configure providers on the{" "}
          <a href="/providers" className="font-medium text-[#ca279c] underline">
            Providers
          </a>{" "}
          page, then return here to connect.
        </p>
      </Card>
    </PageFrame>
  );
}
