"use client";

import * as React from "react";
import { ArrowRight, Bot, BookKey, FileText, Fingerprint, KeyRound, Link2, Shield, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { BrandMark } from "@/components/layout/brand-mark";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { fetchAuthaiPublicKey, fetchMcpCatalog, fetchSkills, type AuthaiPublicKey } from "@/lib/api";
import { fetchV4Grants, fetchV4Providers } from "@/lib/api-v4";
import { brand } from "@/lib/brand";
import { homeChannelTabs } from "@/lib/channel-tabs";

const sections: Array<{
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    href: "/login",
    title: "Sign in",
    description: "Sign in with GitHub or OIDC — everything below needs a user session.",
    icon: KeyRound,
  },
  {
    href: "/connect",
    title: "Connect",
    description: "Connect your OAuth providers once — tokens are stored encrypted, server-side.",
    icon: Link2,
  },
  {
    href: "/devices",
    title: "Mobile approvals",
    description:
      "Pair your iPhone with a QR code and approve agent requests from a push notification, like Okta Verify.",
    icon: Fingerprint,
  },
  {
    href: "/agents",
    title: "Agents",
    description: "Register agents and issue their access tokens for the v4 universal proxy.",
    icon: Bot,
  },
  {
    href: "/grants",
    title: "Grants",
    description: "Review and revoke the connection-level access you granted to agents.",
    icon: Shield,
  },
  {
    href: "/readme",
    title: "Readme",
    description: "Review the project overview, privacy model, and SDK guidance from the repository document.",
    icon: FileText,
  },
  {
    href: "/standards/authentication/1.0",
    title: "Authentication",
    description: "Browse the published CNothing Authentication Standard 1.0.",
    icon: KeyRound,
  },
];

export function HomePage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [publicKey, setPublicKey] = React.useState<AuthaiPublicKey | null>(null);
  const [toolCount, setToolCount] = React.useState(0);
  const [resourceCount, setResourceCount] = React.useState(0);
  const [skillCount, setSkillCount] = React.useState(0);
  const [providerCount, setProviderCount] = React.useState(0);
  const [grantCount, setGrantCount] = React.useState(0);
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
        const providersResponse = await fetchV4Providers(connection);
        setProviderCount(providersResponse.items.length);
      } catch {
        setProviderCount(0);
      }

      try {
        const grantsResponse = await fetchV4Grants(connection);
        setGrantCount(grantsResponse.items.length);
      } catch {
        // Grants require a signed-in user session; that's fine on first visit.
        setGrantCount(0);
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
      title={brand.tagline}
      description={brand.description}
      actions={
        <>
          <ReloadIconButton onReload={() => void refreshOverview()} disabled={loading} />
          <ChannelRouteTabs items={homeChannelTabs} />
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

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricCard icon={ShieldCheck} label="Platform" value="v4" helper="Universal credential-injecting proxy" />
        <MetricCard icon={Link2} label="Providers" value={String(providerCount)} helper="Connectable OAuth providers" />
        <MetricCard icon={Shield} label="Your grants" value={String(grantCount)} helper="Connection-level agent grants" />
        <MetricCard icon={Wrench} label="MCP tools" value={String(toolCount)} helper={`${resourceCount} resources`} />
      </section>

      <Card className="space-y-4 border-[color:var(--brand)]/20 bg-[color:var(--surface-muted)]/40">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[color:var(--brand)]" />
          <h2 className="text-lg font-semibold">How v4 works</h2>
          <Badge className="border-transparent bg-[color:var(--brand)] text-white">Recommended</Badge>
        </div>
        <p className="max-w-3xl text-sm text-slate-600">{brand.principles}</p>
        <p className="text-sm text-slate-600">
          Canonical call: <code className="text-xs">{brand.recommendedInvoke}</code> · Spec:{" "}
          <a href={brand.openApiV4} className="underline">
            {brand.openApiV4}
          </a>
        </p>
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm text-slate-700">
          <li className="rounded-[24px] border border-[color:var(--border)] bg-white/70 p-4">
            <strong>1. Connect</strong>
            <p className="mt-2 text-slate-600">
              <a href="/connect" className="underline">
                Connect
              </a>{" "}
              a provider once — tokens stay encrypted server-side.
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-white/70 p-4">
            <strong>2. Agent requests access</strong>
            <p className="mt-2 text-slate-600">
              <code className="text-xs">POST /v4/access-requests</code> returns an approval link for you.
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-white/70 p-4">
            <strong>3. Approve once</strong>
            <p className="mt-2 text-slate-600">
              Pick your connection on the approval page — one click, one time.
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-white/70 p-4">
            <strong>4. Agent calls any API</strong>
            <p className="mt-2 text-slate-600">
              <code className="text-xs">POST /v4/proxy</code> — token injected, response redacted, fully audited.
            </p>
          </li>
        </ol>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <BrandMark size="md" className="shrink-0" />
              <div className="space-y-2">
                <Badge className="border-transparent bg-[color:var(--brand)] text-white">{brand.tagline}</Badge>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                  {brand.tagline}
                </h2>
                <p className="max-w-2xl text-sm text-slate-600">
                  {brand.description}
                </p>
              </div>
            </div>
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
            <div className="rounded-[24px] bg-[color:var(--surface-muted)]/80 p-4">
              <p className="text-xs text-slate-500">Skills</p>
              <p className="mt-1 text-sm font-medium">{skillCount} bundled skill(s)</p>
            </div>
          </div>
        </Card>
      </section>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[color:var(--brand)]" />
          <h2 className="text-lg font-semibold">For AI Agents</h2>
        </div>
        <p className="max-w-3xl text-sm text-slate-600">
          Agents can integrate over plain HTTP (see the OpenAPI spec) or install the CNothing MCP
          server as their callable tool — hosted at <code className="text-xs">/mcp</code> or locally
          via the <code className="text-xs">cnothing-mcp</code> package.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <DiscoveryLink
            href="/.well-known/mcp"
            title="MCP Discovery"
            description="Machine-readable MCP entry with the v4 universal proxy tools."
          />
          <DiscoveryLink
            href="/mcp/manifest"
            title="MCP Manifest"
            description="Manifest metadata for MCP-compatible hosts and tool discovery."
          />
          <DiscoveryLink
            href="/openapi-v4.json"
            title="OpenAPI v4"
            description="Universal credential-injecting proxy API — access requests, grants, proxy."
          />
          <DiscoveryLink
            href="/skill.md"
            title="Primary Skill"
            description="The v4 quick-start skill for AI agents (plain markdown)."
          />
          <DiscoveryLink
            href="/skills/index.json"
            title="Skills JSON"
            description="Public JSON index of all bundled skills and markdown URLs."
          />
          <DiscoveryLink
            href="/openapi.json"
            title="OpenAPI v1 (legacy)"
            description="Legacy AuthAI + Encrypted KV API — kept for the published v1 standard."
          />
        </div>
      </Card>
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

function DiscoveryLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <a
      href={href}
      className="group rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4 transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">{title}</h3>
          <p className="mt-2 text-sm text-slate-600">{description}</p>
          <p className="mt-3 text-xs text-slate-500">{href}</p>
        </div>
        <ArrowRight className="mt-0.5 h-4 w-4 text-slate-400 transition group-hover:text-slate-900" />
      </div>
    </a>
  );
}
