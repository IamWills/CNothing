"use client";

import * as React from "react";
import { Layers } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { fetchGatewayCapabilities, type GatewayCapability } from "@/lib/api-v3";
import { dashboardTabs } from "@/lib/v2-channel-tabs";

function approvalBadge(policy: string) {
  if (policy === "none") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (policy === "every_time") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

export function DashboardCapabilitiesPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [items, setItems] = React.useState<GatewayCapability[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchGatewayCapabilities(connection);
      setItems(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load capabilities.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageFrame
      title="Capabilities"
      description="Secretless capability registry. Agents invoke by handle; approval_policy and risk_level are visible, secrets never are."
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
            <Layers className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Registered capabilities</h2>
          </div>
        </div>
        <div className="divide-y">
          {items.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No capabilities yet.</p>
          ) : (
            items.map((cap) => (
              <div key={cap.id} className="grid gap-2 px-6 py-4 lg:grid-cols-[1.4fr_1fr_auto]">
                <div>
                  <p className="font-medium">{cap.name}</p>
                  <p className="text-sm text-slate-600">{cap.description}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    provider={cap.provider ?? "—"} · scopes={(cap.required_scopes ?? []).join(", ") || "none"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{cap.execution_type}</Badge>
                  <Badge>{cap.risk_level}</Badge>
                  <Badge className={approvalBadge(cap.approval_policy)}>
                    approval: {cap.approval_policy}
                  </Badge>
                </div>
                <Badge>{cap.status}</Badge>
              </div>
            ))
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
