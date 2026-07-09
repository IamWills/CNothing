"use client";

import * as React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { PageFrame } from "@/components/layout/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import {
  decideGatewayApproval,
  fetchGatewayApproval,
  type GatewayApproval,
} from "@/lib/api-v3";
import { formatDate } from "@/lib/console-utils";

export default function ApprovalDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? undefined;
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [approval, setApproval] = React.useState<GatewayApproval | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [execution, setExecution] = React.useState<unknown>(null);

  const refresh = React.useCallback(async () => {
    setErrorMessage("");
    try {
      const response = await fetchGatewayApproval(connection, params.id);
      setApproval(response);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load approval.");
    }
  }, [connection, params.id]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function decide(decision: "approved" | "rejected") {
    setErrorMessage("");
    setStatusMessage("");
    try {
      const result = await decideGatewayApproval(connection, params.id, decision, token);
      setStatusMessage(`Approval ${decision}.`);
      setExecution(result.execution ?? null);
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to decide approval.");
    }
  }

  return (
    <PageFrame
      title="Approve capability invocation"
      description="Review the safe summary and approve or reject. Secrets are never shown."
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

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[color:var(--brand)]" />
          <h2 className="text-lg font-semibold">Safe summary</h2>
        </div>
        {approval ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge>{approval.status}</Badge>
              <Badge>{approval.risk_level}</Badge>
            </div>
            <p className="text-sm text-slate-800">{approval.safe_summary}</p>
            <p className="text-xs text-slate-500">
              capability {approval.capability_id} · expires {formatDate(approval.expires_at)}
            </p>
            {approval.status === "pending" ? (
              <div className="flex gap-2 pt-2">
                <Button onClick={() => void decide("approved")}>Approve & execute</Button>
                <Button variant="outline" onClick={() => void decide("rejected")}>
                  Reject
                </Button>
              </div>
            ) : null}
            {execution ? (
              <pre className="mt-4 overflow-auto rounded bg-slate-50 p-3 text-xs">
                {JSON.stringify(execution, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
      </Card>
    </PageFrame>
  );
}
