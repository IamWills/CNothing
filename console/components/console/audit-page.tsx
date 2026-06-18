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
import { fetchV2Audit, type V2AuditEvent } from "@/lib/api-v2";
import { v2ChannelTabs } from "@/lib/v2-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function AuditPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [events, setEvents] = React.useState<V2AuditEvent[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchV2Audit(connection, 100);
      setEvents(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load audit events.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageFrame
      title="Invoke Audit"
      description="Every capability invocation is recorded with policy decisions, agent identity, and execution status."
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
        errorMessage={errorMessage}
      />

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Recent invocations</h2>
          </div>
        </div>
        <div className="divide-y">
          {events.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No audit events yet.</p>
          ) : (
            events.map((event) => (
              <div key={event.id} className="grid gap-2 px-6 py-4 lg:grid-cols-[1.2fr_1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{event.capability_name}</p>
                    <Badge className={event.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : undefined}>
                      {event.status}
                    </Badge>
                    <Badge>{event.policy_decision}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    User {event.user_id ?? "n/a"} · Agent {event.agent_id ?? "n/a"}
                  </p>
                  {event.error_code ? (
                    <p className="mt-1 text-sm text-red-600">{event.error_code}</p>
                  ) : null}
                </div>
                <p className="font-mono text-xs text-slate-500">{event.request_id ?? "no request id"}</p>
                <p className="text-sm text-slate-500">{formatDate(event.created_at)}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
