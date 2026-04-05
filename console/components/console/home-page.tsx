"use client";

import * as React from "react";
import { ArrowRight, BookKey, FileText, Fingerprint, KeyRound, RefreshCcw, Shield, Sparkles, Wrench } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { PageFrame } from "@/components/layout/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { fetchAuthaiPublicKey, fetchClients, fetchMcpCatalog, fetchSkills, type AuthaiPublicKey } from "@/lib/api";
import { brand } from "@/lib/brand";

const sections: Array<{
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    href: "/readme",
    title: "Readme",
    description: "Review the project overview, privacy model, and SDK guidance from the repository document.",
    icon: FileText,
  },
  {
    href: "/catalog",
    title: "Catalog",
    description: "Browse MCP tools, resources, and shipped skills from the public backend APIs.",
    icon: Wrench,
  },
  {
    href: "/clients",
    title: "Clients",
    description: "Register public keys manually and review the clients that can talk to CNothing.",
    icon: Fingerprint,
  },
  {
    href: "/kv",
    title: "KV",
    description: "Inspect namespaces, saved key names, and decrypted JSON values through the admin API.",
    icon: KeyRound,
  },
];

export function HomePage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [publicKey, setPublicKey] = React.useState<AuthaiPublicKey | null>(null);
  const [toolCount, setToolCount] = React.useState(0);
  const [resourceCount, setResourceCount] = React.useState(0);
  const [skillCount, setSkillCount] = React.useState(0);
  const [clientCount, setClientCount] = React.useState(0);
  const [statusMessage, setStatusMessage] = React.useState("");
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refreshOverview = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const [publicKeyResponse, mcpResponse, skillsResponse] = await Promise.all([
        fetchAuthaiPublicKey(connection),
        fetchMcpCatalog(connection),
        fetchSkills(connection),
      ]);

      setPublicKey(publicKeyResponse.authai_public_key);
      setToolCount(mcpResponse.tools.length);
      setResourceCount(mcpResponse.resources.length);
      setSkillCount(skillsResponse.items.length);

      try {
        const clientsResponse = await fetchClients(connection);
        setClientCount(clientsResponse.items.length);
      } catch (error) {
        setClientCount(0);
        setStatusMessage(
          error instanceof Error ? error.message : "Admin endpoints are not available yet.",
        );
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load CNothing overview.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  return (
    <PageFrame
      title={`${brand.name} keeps the useful surface visible and the secrets behind it.`}
      description="Use the dedicated pages below to move between discovery, client onboarding, and KV inspection without stacking every workflow into one dense screen."
      actions={
        <Button variant="secondary" onClick={() => void refreshOverview()} disabled={loading}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
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

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricCard
          icon={Shield}
          label="AuthAI identity"
          value={publicKey?.key_id ?? "Loading..."}
          helper="Current key id"
        />
        <MetricCard
          icon={Wrench}
          label="MCP tools"
          value={String(toolCount)}
          helper={`${resourceCount} resources are also published`}
        />
        <MetricCard
          icon={Sparkles}
          label="Skills"
          value={String(skillCount)}
          helper="Markdown skills discoverable by AI"
        />
        <MetricCard
          icon={Fingerprint}
          label="Clients"
          value={String(clientCount)}
          helper="Admin-visible registered client identities"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-5">
          <div className="space-y-2">
            <Badge className="border-transparent bg-slate-900 text-white">{brand.tagline}</Badge>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
              A calmer front door for CNothing
            </h2>
            <p className="max-w-2xl text-sm text-slate-600">
              The console now separates discovery, registration, and KV review into their own pages.
              Each page stays focused on a single workflow while still sharing the same backend APIs and
              connection settings.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <a
                  key={section.href}
                  href={section.href}
                  className="group rounded-[28px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-5 transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="rounded-full bg-white p-3 text-slate-900 shadow-sm">
                      <Icon className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:text-slate-900" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-slate-950">{section.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{section.description}</p>
                </a>
              );
            })}
          </div>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <BookKey className="h-4 w-4 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Identity snapshot</h2>
          </div>
          <div className="grid gap-3">
            <div className="rounded-[24px] bg-[color:var(--surface-muted)]/80 p-4">
              <p className="text-xs text-slate-500">Algorithm</p>
              <p className="mt-1 text-sm font-medium">{publicKey?.algorithm ?? "Loading..."}</p>
            </div>
            <div className="rounded-[24px] bg-[color:var(--surface-muted)]/80 p-4">
              <p className="text-xs text-slate-500">Fingerprint</p>
              <p className="mt-1 break-all text-sm font-medium">
                {publicKey?.public_key_fingerprint ?? "Loading..."}
              </p>
            </div>
          </div>
        </Card>
      </section>
    </PageFrame>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <Icon className="h-4 w-4 text-[color:var(--brand)]" />
        {label}
      </div>
      <p className="break-all text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="text-xs text-slate-500">{helper}</p>
    </Card>
  );
}
