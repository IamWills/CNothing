"use client";

import * as React from "react";
import { Activity, Link2 } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import {
  fetchGatewayAudit,
  fetchGatewayAuditChain,
  type GatewayAuditEvent,
} from "@/lib/api-v3";
import { dashboardTabs } from "@/lib/v2-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function DashboardAuditPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [items, setItems] = React.useState<GatewayAuditEvent[]>([]);
  const [chainEvents, setChainEvents] = React.useState<GatewayAuditEvent[]>([]);
  const [chainId, setChainId] = React.useState("");
  const [chainValid, setChainValid] = React.useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const fromQuery = params.get("chain") ?? "";
      if (fromQuery && !chainId) setChainId(fromQuery);

      const response = await fetchGatewayAudit(connection, 100);
      setItems(response.items);

      const activeChain = fromQuery || chainId;
      if (activeChain) {
        const chain = await fetchGatewayAuditChain(connection, activeChain);
        setChainEvents(chain.events);
        setChainValid(chain.integrity.valid);
      } else {
        setChainEvents([]);
        setChainValid(null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load audit.");
    } finally {
      setLoading(false);
    }
  }, [connection, chainId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageFrame
      title="Trust Audit"
      description="Hash-linked audit chains for every capability invoke. Secret values are never stored or displayed."
      actions={
        <>
          <ReloadIconButton onReload={() => void refresh()} disabled={loading} />
          <ChannelRouteTabs items={dashboardTabs} />
        </>
      }
    >
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
        errorMessage={errorMessage}
      />

      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-[color:var(--brand)]" />
          <h2 className="text-sm font-semibold">Audit chain view</h2>
          {chainValid === true ? <Badge>integrity ok</Badge> : null}
          {chainValid === false ? <Badge>integrity broken</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-[280px] flex-1 rounded-xl border border-[color:var(--border)] bg-white px-3 py-2 text-sm"
            placeholder="audit_chain_id"
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
          />
          <button
            type="button"
            className="rounded-xl bg-[color:var(--brand)] px-4 py-2 text-sm text-white"
            onClick={() => void refresh()}
          >
            Load chain
          </button>
        </div>
        {chainEvents.length > 0 ? (
          <ol className="space-y-2 border-l-2 border-[color:var(--border)] pl-4">
            {chainEvents.map((event) => (
              <li key={event.id} className="text-sm">
                <span className="font-mono text-xs text-slate-400">#{event.sequence_no ?? "—"}</span>{" "}
                <strong>{event.event_type}</strong>{" "}
                {event.result ? <Badge>{event.result}</Badge> : null}
                <p className="text-slate-600">{event.input_summary ?? "—"}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">Enter an audit_chain_id from an execution to view the linked chain.</p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Recent trust events</h2>
          </div>
        </div>
        <div className="divide-y">
          {items.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No audit events yet.</p>
          ) : (
            items.map((event) => (
              <div key={event.id} className="grid gap-2 px-6 py-4 lg:grid-cols-[1.2fr_1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{event.event_type}</p>
                    {event.result ? <Badge>{event.result}</Badge> : null}
                    {event.risk_level ? <Badge>{event.risk_level}</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {event.input_summary ?? "—"}
                  </p>
                  {event.audit_chain_id ? (
                    <button
                      type="button"
                      className="mt-1 text-xs underline"
                      onClick={() => {
                        setChainId(event.audit_chain_id!);
                        void refresh();
                      }}
                    >
                      View chain {event.audit_chain_id.slice(0, 12)}…
                    </button>
                  ) : null}
                </div>
                <p className="text-sm text-slate-600">
                  {event.execution_id ? `exec=${event.execution_id.slice(0, 8)}…` : "—"}
                </p>
                <p className="text-xs text-slate-500">{formatDate(event.created_at)}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
