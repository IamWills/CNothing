"use client";

import * as React from "react";
import { Activity } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { fetchGatewayAudit, type GatewayAuditEvent } from "@/lib/api-v3";
import { dashboardTabs } from "@/lib/v2-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function DashboardAuditPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [items, setItems] = React.useState<GatewayAuditEvent[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchGatewayAudit(connection, 100);
      setItems(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load audit.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageFrame
      title="Trust Audit"
      description="Who / what / when / why for every capability call. Secret values are never stored or displayed."
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
                </div>
                <div className="text-xs text-slate-500">
                  <p>agent: {event.agent_id ?? "—"}</p>
                  <p>capability: {event.capability_id ?? "—"}</p>
                  <p>execution: {event.execution_id ?? "—"}</p>
                  <p>approval: {event.approval_id ?? "—"}</p>
                </div>
                <p className="text-xs text-slate-500">{formatDate(event.created_at)}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
