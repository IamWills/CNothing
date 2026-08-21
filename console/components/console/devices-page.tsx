"use client";

import * as React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Smartphone, XCircle } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useConsoleAuth } from "@/hooks/use-console-auth";
import {
  createV4DevicePairingCode,
  createV4ShareCode,
  fetchV4AgentId,
  fetchV4AuthMe,
  fetchV4Devices,
  revokeV4Device,
  sessionFromMe,
  type V4Device,
} from "@/lib/api-v4";
import { consoleTabs } from "@/lib/v4-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function DevicesPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { isLoggedIn, session, syncSessionFromServer, isAdmin } = useConsoleAuth();
  const [devices, setDevices] = React.useState<V4Device[]>([]);
  const [agentId, setAgentId] = React.useState("");
  const [shareCode, setShareCode] = React.useState("");
  const [shareExpiresAt, setShareExpiresAt] = React.useState("");
  const [shareWithAgent, setShareWithAgent] = React.useState("");
  const [pairingCode, setPairingCode] = React.useState("");
  const [qrPayload, setQrPayload] = React.useState("");
  const [pairingExpiresAt, setPairingExpiresAt] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      try {
        const me = await fetchV4AuthMe(connection);
        syncSessionFromServer(sessionFromMe(me));
      } catch {
        // not signed in
      }
      const [devicesResponse, agentResponse] = await Promise.all([
        fetchV4Devices(connection).catch(() => ({ ok: true as const, items: [] as V4Device[] })),
        fetchV4AgentId(connection).catch(() => null),
      ]);
      setDevices(devicesResponse.items);
      if (agentResponse) {
        setAgentId(agentResponse.user_id);
        setShareWithAgent(agentResponse.share_with_agent);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load devices.");
    } finally {
      setLoading(false);
    }
  }, [connection, syncSessionFromServer]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleGenerateCode() {
    setErrorMessage("");
    setStatusMessage("");
    try {
      const result = await createV4DevicePairingCode(connection);
      setPairingCode(result.pairing_code);
      setQrPayload(result.qr_payload);
      setPairingExpiresAt(result.expires_at);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create pairing code.");
    }
  }

  async function handleGenerateShareCode() {
    setErrorMessage("");
    setStatusMessage("");
    try {
      const result = await createV4ShareCode(connection);
      setAgentId(result.user_id);
      setShareCode(result.share_code);
      setShareExpiresAt(result.expires_at);
      setShareWithAgent(result.share_with_agent);
      setStatusMessage("Share code ready — copy and paste it to your agent.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create share code.");
    }
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatusMessage(`Copied ${label}.`);
    } catch {
      setErrorMessage("Clipboard unavailable — select and copy manually.");
    }
  }

  async function handleRevoke(deviceId: string) {
    setErrorMessage("");
    setStatusMessage("");
    try {
      await revokeV4Device(connection, deviceId);
      setStatusMessage("Device revoked. It can no longer approve requests.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Revoke failed.");
    }
  }

  const displayUserId = agentId || session?.userId || "";

  return (
    <PageFrame
      title="Devices"
      description="Pair your phone as an authenticator. Share your agent ID or short code so agents can push approval requests to your phone."
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

      {!isLoggedIn && !displayUserId ? (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Sign in first (Login page) to pair devices with your account.
        </Card>
      ) : null}

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}
      {statusMessage ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{statusMessage}</Card>
      ) : null}

      {displayUserId ? (
        <Card className="space-y-4 p-6">
          <div>
            <h2 className="text-lg font-semibold">Your agent ID</h2>
            <p className="mt-1 text-sm text-slate-600">
              Give this to your AI agent (as <code className="text-xs">user_id</code>) so approval
              requests push to your paired phone. Or generate a short code.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-md bg-slate-100 px-3 py-2 font-mono text-sm text-slate-900">
              {displayUserId}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copyText("agent ID", displayUserId)}
            >
              <Copy className="mr-1 h-4 w-4" />
              Copy ID
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void handleGenerateShareCode()}>Generate short code</Button>
            {shareCode ? (
              <>
                <code className="rounded-md bg-slate-100 px-3 py-2 font-mono text-lg font-semibold tracking-wider text-slate-900">
                  {shareCode}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText("share code", shareCode)}
                >
                  <Copy className="mr-1 h-4 w-4" />
                  Copy code
                </Button>
                {shareExpiresAt ? (
                  <span className="text-xs text-slate-500">Expires {formatDate(shareExpiresAt)}</span>
                ) : null}
              </>
            ) : null}
          </div>
          {shareWithAgent ? (
            <div className="space-y-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)]/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Share with agent
              </p>
              <p className="text-sm text-slate-800">{shareWithAgent}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyText("message", shareWithAgent)}
              >
                <Copy className="mr-1 h-4 w-4" />
                Copy message
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-[color:var(--brand)]" />
          <h2 className="text-lg font-semibold">Pair a new device</h2>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Generate a code, then scan the QR with the CNothing iOS app (or type the code manually)
          within 10 minutes.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <Button onClick={() => void handleGenerateCode()} disabled={!isLoggedIn && !displayUserId}>
            Generate pairing code
          </Button>
          {pairingCode ? (
            <div className="flex items-center gap-6">
              {qrPayload ? (
                <div className="rounded-lg border border-[color:var(--border)] bg-white p-3">
                  <QRCodeSVG value={qrPayload} size={160} marginSize={1} />
                </div>
              ) : null}
              <div>
                <p className="text-xs text-slate-500">Manual code</p>
                <p className="font-mono text-2xl font-bold tracking-widest text-slate-900">
                  {pairingCode}
                </p>
                <p className="mt-1 text-xs text-slate-500">Expires {formatDate(pairingExpiresAt)}</p>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[color:var(--border)] px-6 py-4">
          <h2 className="text-lg font-semibold">Paired devices</h2>
        </div>
        <div className="divide-y divide-[color:var(--border)]">
          {devices.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No devices yet. Install the CNothing iOS app and pair it with a code.
            </p>
          ) : (
            devices.map((device) => (
              <div key={device.id} className="grid gap-3 px-6 py-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{device.device_name || device.platform}</p>
                    <Badge variant={device.status === "active" ? "default" : "secondary"}>
                      {device.status}
                    </Badge>
                    {device.has_push_token ? (
                      <Badge variant="outline">push enabled</Badge>
                    ) : (
                      <Badge variant="outline">polling only</Badge>
                    )}
                    {device.key_registered ? (
                      <Badge variant="outline">device-bound key</Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-600">
                        no key — re-pair
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Paired {formatDate(device.created_at)}
                    {device.last_seen_at ? ` · Last seen ${formatDate(device.last_seen_at)}` : ""}
                  </p>
                </div>
                <div className="flex items-start">
                  {device.status === "active" ? (
                    <Button variant="outline" size="sm" onClick={() => void handleRevoke(device.id)}>
                      <XCircle className="mr-1 h-4 w-4" />
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
