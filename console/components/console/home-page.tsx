"use client";

import * as React from "react";
import { ArrowRight, Bot, BookKey, FileText, Fingerprint, KeyRound, Shield, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { BrandMark } from "@/components/layout/brand-mark";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { fetchAuthaiPublicKey, fetchClients, fetchMcpCatalog, fetchSkills, type AuthaiPublicKey } from "@/lib/api";
import { fetchPlatformStatus } from "@/lib/api-v2";
import {
  fetchV3Agents,
  fetchV3Capabilities,
  fetchV3Grants,
  fetchV3PlatformStatus,
  fetchV3Providers,
} from "@/lib/api-v3";
import { brand } from "@/lib/brand";
import { homeChannelTabs } from "@/lib/channel-tabs";

const sections: Array<{
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    href: "/standards/authentication/1.0",
    title: "Authentication",
    description: "Browse the published CNothing Authentication Standard 1.0 as an expandable implementation profile.",
    icon: ShieldCheck,
  },
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
    href: "/agents",
    title: "Agents (v3)",
    description: "Register agents, manage grants, and review capability invoke audit logs via v3 Trust Broker.",
    icon: Bot,
  },
  {
    href: "/standards/registration-hub",
    title: "Registration Hub",
    description: "Review the architecture standard for using CNothing as an AI-safe website registration control plane.",
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
  const [agentCount, setAgentCount] = React.useState(0);
  const [capabilityCount, setCapabilityCount] = React.useState(0);
  const [grantCount, setGrantCount] = React.useState(0);
  const [connectorCount, setConnectorCount] = React.useState(0);
  const [v1SunsetAt, setV1SunsetAt] = React.useState("");
  const [platformVersion, setPlatformVersion] = React.useState("");
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
      } catch {
        setClientCount(0);
      }

      try {
        const [platformResponse, v3Status] = await Promise.all([
          fetchPlatformStatus(connection),
          fetchV3PlatformStatus(connection),
        ]);
        setPlatformVersion(v3Status.version || platformResponse.platform.version);
        setV1SunsetAt(platformResponse.v1.sunset_at);
      } catch {
        setPlatformVersion("");
        setV1SunsetAt("");
      }

      try {
        const [agentsResponse, capabilitiesResponse, grantsResponse, providersResponse] =
          await Promise.all([
            fetchV3Agents(connection),
            fetchV3Capabilities(connection),
            fetchV3Grants(connection),
            fetchV3Providers(connection),
          ]);
        setAgentCount(agentsResponse.items.length);
        setCapabilityCount(capabilitiesResponse.items.length);
        setGrantCount(grantsResponse.items.length);
        setConnectorCount(providersResponse.items.length);
      } catch (error) {
        setAgentCount(0);
        setCapabilityCount(0);
        setGrantCount(0);
        setConnectorCount(0);
        if (!statusMessage) {
          setStatusMessage(
            error instanceof Error ? error.message : "Some v3 admin endpoints are unavailable.",
          );
        }
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
        <MetricCard icon={Bot} label="Platform" value={platformVersion || "v3"} helper="Execution Trust Layer" />
        <MetricCard icon={Bot} label="Agents" value={String(agentCount)} helper="Registered AI agents" />
        <MetricCard icon={Sparkles} label="Capabilities" value={String(capabilityCount)} helper="Executable capabilities" />
        <MetricCard icon={Shield} label="Active grants" value={String(grantCount)} helper="User → agent authorizations" />
      </section>

      <Card className="space-y-4 border-[color:var(--brand)]/20 bg-[color:var(--surface-muted)]/40">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[color:var(--brand)]" />
          <h2 className="text-lg font-semibold">Execution Trust Layer</h2>
        </div>
        <p className="max-w-3xl text-sm text-slate-600">
          Agent thinks. cnothing executes. Secrets never leave cnothing. Every risky action is approved, executed, and audited.
        </p>
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm text-slate-700">
          <li className="rounded-[24px] border border-[color:var(--border)] bg-white/70 p-4">
            <strong>1. Connect</strong>
            <p className="mt-2 text-slate-600">
              <a href="/connect" className="underline">Connect</a> GitHub — tokens go to Secret Vault.
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-white/70 p-4">
            <strong>2. Grant</strong>
            <p className="mt-2 text-slate-600">
              Authorize agent for <code className="text-xs">github.*</code> capabilities.
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-white/70 p-4">
            <strong>3. Invoke</strong>
            <p className="mt-2 text-slate-600">
              <code className="text-xs">POST /api/v3/capabilities/:id/invoke</code> — Policy → Approval → Worker.
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-white/70 p-4">
            <strong>4. Audit</strong>
            <p className="mt-2 text-slate-600">
              Review chain at <a href="/dashboard/audit" className="underline">Audit</a> ·{" "}
              <a href="/dashboard/executions" className="underline">Executions</a>.
            </p>
          </li>
        </ol>
      </Card>

      {v1SunsetAt ? (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          v1 AuthAI/KV is deprecated. Sunset date: <strong>{v1SunsetAt}</strong>.{" "}
          <a href="/migration" className="underline">
            Migrate KV records
          </a>{" "}
          or read{" "}
          <a href={`${connection.baseUrl.replace(/\/+$/, "")}/openapi-v2.json`} className="underline">
            openapi-v2.json
          </a>
          .
        </Card>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-4">
        <MetricCard icon={Fingerprint} label="Clients (v1)" value={String(clientCount)} helper="Legacy AuthAI clients" />
        <MetricCard icon={Fingerprint} label="Connectors" value={String(connectorCount)} helper="Registered backend connectors" />
        <MetricCard icon={Sparkles} label="Skills" value={String(skillCount)} helper="Markdown skills for AI discovery" />
        <MetricCard icon={Wrench} label="MCP tools" value={String(toolCount)} helper={`${resourceCount} resources`} />
      </section>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[color:var(--brand)]" />
          <h2 className="text-lg font-semibold">v2.5 Platform Quick Start</h2>
        </div>
        <p className="max-w-3xl text-sm text-slate-600">
          Connect OAuth once, import OpenAPI or MCP specs, grant capabilities to agents — no custom connector
          deployment required.
        </p>
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 text-sm text-slate-700">
          <li className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4">
            <strong>1. Configure providers</strong>
            <p className="mt-2 text-slate-600">
              <a href="/providers" className="underline">Providers</a> → register OAuth client credentials.
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4">
            <strong>2. Import capabilities</strong>
            <p className="mt-2 text-slate-600">
              <a href="/import" className="underline">Import</a> → OpenAPI or MCP manifest → activate selected tools.
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4">
            <strong>3. Register an agent</strong>
            <p className="mt-2 text-slate-600">
              <a href="/agents" className="underline">Agents</a> → copy the agent access token (shown once).
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4">
            <strong>4. User connects OAuth</strong>
            <p className="mt-2 text-slate-600">
              <a href="/connect" className="underline">Connect</a> → user links GitHub or other providers once.
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4">
            <strong>5. Authorize & invoke</strong>
            <p className="mt-2 text-slate-600">
              Agent calls <code className="text-xs">POST /v2/agent/authorizations</code> → user approves at{" "}
              <code className="text-xs">/approve/:id</code> →{" "}
              <code className="text-xs">POST /v2/agent/invoke</code>.
            </p>
          </li>
          <li className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4">
            <strong>6. Audit</strong>
            <p className="mt-2 text-slate-600">
              Review policy decisions at <a href="/audit" className="underline">Audit</a>.
              API spec: <a href="/openapi-v2.5.json" className="underline">openapi-v2.5.json</a>.
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
                  {brand.description} Policy Engine, Approval Engine, Secret Vault, and Execution Workers keep tokens inside cnothing.
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
          </div>
        </Card>
      </section>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[color:var(--brand)]" />
          <h2 className="text-lg font-semibold">For AI Agents</h2>
        </div>
        <p className="max-w-3xl text-sm text-slate-600">
          Start from the discovery endpoints below when another agent or host needs to understand
          what CNothing exposes, how to integrate safely, and where to find skills and standards.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <DiscoveryLink
            href="/.well-known/mcp"
            title="MCP Discovery"
            description="Machine-readable MCP entry with cross-links to skills, guides, and standards."
          />
          <DiscoveryLink
            href="/mcp/manifest"
            title="MCP Manifest"
            description="Manifest metadata for MCP-compatible hosts and tool discovery."
          />
          <DiscoveryLink
            href="/skills/index.json"
            title="Skills JSON"
            description="Public JSON index of all bundled skills and markdown URLs."
          />
          <DiscoveryLink
            href="/skills.txt"
            title="Skills Text"
            description="Plain-text skills directory for simpler crawlers and basic agents."
          />
          <DiscoveryLink
            href="/openapi-v2.json"
            title="OpenAPI v2"
            description="Capability platform API specification for agents and connectors."
          />
          <DiscoveryLink
            href="/getting-started.md"
            title="Getting Started"
            description="Quick-start skill for safe first-time CNothing integrations."
          />
          <DiscoveryLink
            href="/standards"
            title="Standards"
            description="Published authentication and registration-hub standards."
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
