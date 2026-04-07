import { BookOpenText, ExternalLink, FileJson, Sparkles } from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { Card } from "@/components/ui/card";
import type { PublicSkillEntry } from "@/lib/public-skills";

export function SkillsPage({ skills }: { skills: PublicSkillEntry[] }) {
  return (
    <PageFrame
      title="Skills"
      description="Public CNothing skill discovery for AI agents and integrators, including markdown URLs, a JSON index, and a quick-start guide."
    >
      <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Discovery endpoints</h2>
          </div>
          <div className="space-y-3 text-sm text-slate-700">
            <EndpointRow href="/skills/index.json" label="Public skills JSON index" />
            <EndpointRow href="/getting-started.md" label="Quick-start skill markdown" />
            <EndpointRow href="/skill.md" label="Primary protocol skill markdown" />
            <EndpointRow href="/.well-known/mcp" label="MCP discovery endpoint" />
          </div>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Bundled skills</h2>
          </div>
          <div className="grid gap-3">
            {skills.map((skill) => (
              <div
                key={skill.id}
                id={skill.slug}
                className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">{skill.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">{skill.description}</p>
                    <p className="mt-2 text-xs text-slate-500">{skill.filePath}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <SkillLink href={skill.markdownPath} label="Markdown" />
                    <SkillLink href={skill.publicPath} label="Anchor" />
                  </div>
                </div>
                <pre className="mt-4 overflow-x-auto rounded-[20px] bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
                  {skill.markdown}
                </pre>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </PageFrame>
  );
}

function EndpointRow({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex items-center justify-between gap-3 rounded-[20px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 px-4 py-3 transition hover:border-slate-400 hover:bg-white"
    >
      <div className="flex items-center gap-3">
        <BookOpenText className="h-4 w-4 text-[color:var(--brand)]" />
        <div>
          <p className="font-medium text-slate-950">{label}</p>
          <p className="text-xs text-slate-500">{href}</p>
        </div>
      </div>
      <ExternalLink className="h-4 w-4 text-slate-400" />
    </a>
  );
}

function SkillLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-400"
    >
      {label}
      <ExternalLink className="h-4 w-4 text-slate-400" />
    </a>
  );
}
