"use client";

import * as React from "react";
import { ArrowRight, Bot, Fingerprint, KeyRound, Link2, Shield, Wrench } from "lucide-react";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Card } from "@/components/ui/card";
import { sameOriginConnection } from "@/lib/api";
import { fetchV4Grants, fetchV4Providers } from "@/lib/api-v4";
import { brand } from "@/lib/brand";
import { homeChannelTabs } from "@/lib/channel-tabs";

const sections = [
  { href: "/login", title: "Sign in", description: "Authenticate with GitHub or OIDC.", icon: KeyRound },
  { href: "/connect", title: "Connect providers", description: "Create encrypted OAuth connections.", icon: Link2 },
  { href: "/devices", title: "iOS approvals", description: "Pair devices and receive signed push approvals.", icon: Fingerprint },
  { href: "/agents", title: "Agents", description: "Approve plugin pairing. Tokens stay in the host, not in chat.", icon: Bot },
  { href: "/grants", title: "Grants", description: "Review and revoke approved API access.", icon: Shield },
];

export function HomePage() {
  const visibleSections = sections;
  const [providerCount, setProviderCount] = React.useState(0);
  const [grantCount, setGrantCount] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const connection = sameOriginConnection();
    if (!connection.baseUrl) return;
    setLoading(true);
    setErrorMessage("");
    const [providers, grants] = await Promise.allSettled([
      fetchV4Providers(connection),
      fetchV4Grants(connection),
    ]);
    setProviderCount(providers.status === "fulfilled" ? providers.value.items.length : 0);
    setGrantCount(grants.status === "fulfilled" ? grants.value.items.length : 0);
    if (providers.status === "rejected") setErrorMessage("Unable to load the v4 service overview.");
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageFrame
      title={brand.tagline}
      description="User-approved OAuth access for AI agents, with encrypted token storage and iOS push approval."
      actions={
        <>
          <ReloadIconButton onReload={() => void refresh()} disabled={loading} />
          <ChannelRouteTabs items={homeChannelTabs} />
        </>
      }
    >
      {errorMessage ? (
        <p className="rounded-[20px] bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>
      ) : null}
      <section className="grid gap-4 md:grid-cols-3">
        <Metric icon={Link2} label="OAuth providers" value={providerCount} />
        <Metric icon={Shield} label="Your grants" value={grantCount} />
        <Metric icon={Wrench} label="MCP tools" value={5} />
      </section>
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Required workflow</h2>
        <ol className="grid gap-3 text-sm md:grid-cols-4">
          <li className="rounded-2xl bg-slate-50 p-4">
            <strong>1. Sign in</strong>
            <p className="mt-2 text-slate-600">Humans authenticate at /login. Admins use the same page.</p>
          </li>
          <li className="rounded-2xl bg-slate-50 p-4">
            <strong>2. Connect</strong>
            <p className="mt-2 text-slate-600">The user connects a provider once.</p>
          </li>
          <li className="rounded-2xl bg-slate-50 p-4">
            <strong>3. Approve</strong>
            <p className="mt-2 text-slate-600">Approve in the browser or iOS app.</p>
          </li>
          <li className="rounded-2xl bg-slate-50 p-4">
            <strong>4. Proxy</strong>
            <p className="mt-2 text-slate-600">CNothing injects credentials server-side.</p>
          </li>
        </ol>
      </Card>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {visibleSections.map(({ href, title, description, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="group rounded-[24px] border border-slate-200 bg-white p-5 transition hover:border-slate-400"
          >
            <div className="flex items-center justify-between">
              <Icon className="h-5 w-5" />
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </div>
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-slate-600">{description}</p>
          </a>
        ))}
      </section>
    </PageFrame>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </Card>
  );
}
