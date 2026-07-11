"use client";

import * as React from "react";
import { Scale } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { fetchGatewayPolicies, type GatewayPolicyBundle } from "@/lib/api-v3";
import { dashboardTabs } from "@/lib/v2-channel-tabs";

export function DashboardPoliciesPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [bundle, setBundle] = React.useState<GatewayPolicyBundle | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetchGatewayPolicies(connection);
      setBundle(response);
      setLoaded(true);
    } catch (error) {
      setBundle(null);
      setLoaded(false);
      setErrorMessage(error instanceof Error ? error.message : "Unable to load policies.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const trustPolicies = bundle?.trust_policies ?? [];
  const capabilityPermissions = bundle?.capability_permissions ?? [];
  const legacyPolicies = bundle?.policies ?? [];

  return (
    <PageFrame
      title="Policies"
      description="Capability allow/deny rules, approval requirements, and rate limits. Agents only see policy outcomes, never secrets."
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
            <Scale className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Trust Policy Engine</h2>
            {loaded && bundle?.trust_policy_engine?.ready ? (
              <Badge>{bundle.trust_policy_engine.count ?? trustPolicies.length} policies</Badge>
            ) : null}
          </div>
        </div>
        <div className="divide-y">
          {!loaded && loading ? (
            <p className="p-6 text-sm text-slate-500">Loading policies…</p>
          ) : errorMessage ? (
            <p className="p-6 text-sm text-rose-700">
              Unable to load trust policies. Check admin credentials and try again.
            </p>
          ) : trustPolicies.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No policies configured.</p>
          ) : (
            trustPolicies.map((policy) => (
              <div key={policy.id} className="flex flex-wrap items-center gap-2 px-6 py-4">
                <p className="font-medium">{policy.name}</p>
                <Badge>{policy.effect}</Badge>
                <Badge>{policy.risk_level}</Badge>
                {policy.capability_pattern ? <Badge>{policy.capability_pattern}</Badge> : null}
                {policy.destructive_action_block ? <Badge>destructive_block</Badge> : null}
                <Badge>priority {policy.priority}</Badge>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Capability permissions</h2>
          </div>
        </div>
        <div className="divide-y">
          {errorMessage ? (
            <p className="p-6 text-sm text-slate-500">—</p>
          ) : capabilityPermissions.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No policies configured.</p>
          ) : (
            capabilityPermissions.map((perm) => (
              <div key={perm.id} className="flex flex-wrap items-center gap-2 px-6 py-4">
                <p className="font-medium">{perm.capability_pattern ?? perm.id}</p>
                <Badge>{perm.effect}</Badge>
                {perm.require_approval ? <Badge>require_approval</Badge> : null}
                {perm.rate_limit_per_minute ? (
                  <Badge>rate {perm.rate_limit_per_minute}/min</Badge>
                ) : null}
                <Badge>priority {perm.priority}</Badge>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Legacy policies</h2>
        </div>
        <div className="divide-y">
          {errorMessage ? (
            <p className="p-6 text-sm text-slate-500">—</p>
          ) : legacyPolicies.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No policies configured.</p>
          ) : (
            legacyPolicies.map((policy) => (
              <div key={policy.id} className="flex flex-wrap items-center gap-2 px-6 py-4">
                <p className="font-medium">{policy.capability_pattern ?? policy.id}</p>
                <Badge>{policy.action}</Badge>
                <Badge>priority {policy.priority}</Badge>
              </div>
            ))
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
