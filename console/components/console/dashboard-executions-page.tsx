"use client";

import * as React from "react";
import { PlayCircle } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { fetchGatewayExecutions, type GatewayExecution } from "@/lib/api-v3";
import { dashboardTabs } from "@/lib/v2-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function DashboardExecutionsPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [items, setItems] = React.useState<GatewayExecution[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchGatewayExecutions(connection, 100);
      setItems(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load executions.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageFrame
      title="Executions"
      description="Full capability execution lifecycle: policy → approval → worker → sanitized result. Agents never see secrets."
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
            <PlayCircle className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Execution lifecycle</h2>
          </div>
        </div>
        <div className="divide-y">
          {items.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No executions yet.</p>
          ) : (
            items.map((exec) => (
              <div key={exec.execution_id} className="grid gap-2 px-6 py-4 lg:grid-cols-[1.2fr_1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium font-mono text-sm">{exec.execution_id.slice(0, 8)}…</p>
                    <Badge>{exec.status}</Badge>
                    {exec.dry_run ? <Badge>dry_run</Badge> : null}
                    {exec.worker_type ? <Badge>{exec.worker_type}</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    capability={exec.capability_id.slice(0, 12)}…
                    {exec.policy_decision && typeof exec.policy_decision.decision === "string"
                      ? ` · policy=${String(exec.policy_decision.decision)}`
                      : ""}
                  </p>
                </div>
                <div className="text-sm text-slate-600">
                  {exec.audit_chain_id ? (
                    <a
                      className="underline"
                      href={`/dashboard/audit?chain=${encodeURIComponent(exec.audit_chain_id)}`}
                    >
                      Audit chain
                    </a>
                  ) : (
                    "—"
                  )}
                  {exec.error_code ? <p className="mt-1 text-rose-700">{exec.error_code}</p> : null}
                </div>
                <p className="text-xs text-slate-500">{formatDate(exec.started_at)}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
