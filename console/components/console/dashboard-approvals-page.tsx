"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import {
  decideGatewayApproval,
  fetchGatewayApprovals,
  type GatewayApproval,
} from "@/lib/api-v3";
import { dashboardTabs } from "@/lib/v2-channel-tabs";
import { formatDate } from "@/lib/console-utils";

export function DashboardApprovalsPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [items, setItems] = React.useState<GatewayApproval[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchGatewayApprovals(connection);
      setItems(response.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load approvals.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function decide(approvalId: string, decision: "approved" | "rejected") {
    setErrorMessage("");
    setStatusMessage("");
    try {
      await decideGatewayApproval(connection, approvalId, decision);
      setStatusMessage(`Approval ${approvalId} ${decision}.`);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to decide approval.");
    }
  }

  return (
    <PageFrame
      title="Approvals"
      description="Human approval for risky capability invocations. Only safe summaries are shown — never tokens, cookies, or secrets."
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

      {statusMessage ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {statusMessage}
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Pending & recent approvals</h2>
          </div>
        </div>
        <div className="divide-y">
          {items.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No approvals yet.</p>
          ) : (
            items.map((item) => (
              <div key={item.approval_id} className="grid gap-3 px-6 py-4 lg:grid-cols-[1.5fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">
                      {item.capability_id || item.approval_type || item.approval_id}
                    </p>
                    {item.approval_type ? <Badge>{item.approval_type}</Badge> : null}
                    <Badge>{item.status}</Badge>
                    {item.risk_level ? <Badge>{item.risk_level}</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{item.safe_summary}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.expires_at ? `expires ${formatDate(item.expires_at)}` : "no expiry"}
                    {item.resource_key ? ` · resource ${item.resource_key}` : ""}
                    {item.connection_url ? " · reconnect required" : ""}
                  </p>
                </div>
                {item.status === "pending" ? (
                  <div className="flex gap-2">
                    {item.approval_type === "reauthentication" && item.connection_url ? (
                      <Button
                        onClick={() => {
                          window.location.href = item.connection_url!;
                        }}
                      >
                        Reconnect
                      </Button>
                    ) : (
                      <Button onClick={() => void decide(item.approval_id, "approved")}>
                        Approve
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => void decide(item.approval_id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
