import { ExternalLink } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { ChannelRouteTabs } from "@/components/layout/channel-route-tabs";
import { Card } from "@/components/ui/card";
import { PageFrame } from "@/components/layout/page-frame";
import { authStandard, type StandardPublication, type StandardSection } from "@/lib/auth-standard";
import { standardsChannelTabs } from "@/lib/channel-tabs";

export function AuthStandardPage() {
  return <StandardPublicationPage standard={authStandard} />;
}

export function StandardPublicationPage({ standard }: { standard: StandardPublication }) {
  return (
    <PageFrame
      title="Standards"
      description="Browse the published CNothing standards catalog, then switch between formal specifications and architecture references from the same channel."
      actions={<ChannelRouteTabs items={standardsChannelTabs} />}
    >
      <section className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <BrandMark size="sm" />
              <div>
                <p className="text-sm font-semibold tracking-[0.18em] text-slate-500">
                  CNothing Standard
                </p>
                <p className="text-sm text-slate-600">
                  Fixed publication and export endpoints
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Published</p>
            <p className="text-sm font-medium text-slate-700">{standard.publishedAt}</p>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Version</p>
            <p className="text-sm font-medium text-slate-700">{standard.version}</p>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Status</p>
            <p className="text-sm font-medium text-slate-700">{standard.status}</p>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Canonical path</p>
            <a
              href={standard.canonicalPath}
              className="break-all text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4"
            >
              {standard.canonicalPath}
            </a>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-700">
              <a
                href={`${standard.canonicalPath}/markdown`}
                className="inline-flex items-center gap-1 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-950"
              >
                Export Markdown
                <ExternalLink className="h-4 w-4" />
              </a>
              <a
                href={`${standard.canonicalPath}/html`}
                className="inline-flex items-center gap-1 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-950"
              >
                Export HTML
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <h2 className="text-lg font-semibold text-slate-950">Section tree</h2>
            <StandardTree sections={standard.sections} depth={0} />
          </div>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center gap-4 rounded-[24px] bg-[color:var(--surface-muted)]/70 p-4 text-sm text-slate-600">
            <BrandMark size="sm" className="shrink-0" />
            <p>
              This publication is part of CNothing's public standards library. Each expandable
              section below is normative unless it is explicitly labeled as guidance.
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-3 rounded-[24px] bg-[color:var(--surface-muted)]/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Document</p>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{standard.title}</h2>
              <p className="text-sm text-slate-600">{standard.intro}</p>
            </div>
            {standard.sections.map((section) => (
              <StandardSectionView key={section.id} section={section} depth={0} />
            ))}
          </div>
        </Card>
      </section>
    </PageFrame>
  );
}

function StandardTree({
  sections,
  depth,
}: {
  sections: StandardSection[];
  depth: number;
}) {
  return (
    <div className="space-y-2">
      {sections.map((section) => (
        <div key={section.id} className={depth > 0 ? "ml-4 border-l border-[color:var(--border)] pl-3" : ""}>
          <a
            href={`#${section.id}`}
            className="block rounded-2xl px-3 py-2 text-sm text-slate-700 transition hover:bg-[color:var(--surface-muted)] hover:text-slate-950"
          >
            <span className="block font-medium">{section.title}</span>
            <span className="mt-1 block text-xs text-slate-500">{section.summary}</span>
          </a>
          {section.children?.length ? <StandardTree sections={section.children} depth={depth + 1} /> : null}
        </div>
      ))}
    </div>
  );
}

function StandardSectionView({
  section,
  depth,
}: {
  section: StandardSection;
  depth: number;
}) {
  return (
    <details
      id={section.id}
      open={depth < 2}
      className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/55 p-4"
    >
      <summary className="list-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className={`${depth === 0 ? "text-xl" : "text-lg"} font-semibold text-slate-950`}>
              {section.title}
            </h2>
            <p className="text-sm text-slate-600">{section.summary}</p>
          </div>
          <span className="text-xs uppercase tracking-[0.18em] text-slate-400">Expand</span>
        </div>
      </summary>

      <div className="mt-4 space-y-4 border-t border-[color:var(--border)] pt-4">
        {section.paragraphs?.map((paragraph) => (
          <p key={paragraph} className="text-sm leading-7 text-slate-700">
            {paragraph}
          </p>
        ))}

        {section.bullets?.length ? (
          <ul className="space-y-2 pl-5 text-sm leading-7 text-slate-700">
            {section.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        ) : null}

        {section.code ? (
          <pre className="overflow-x-auto rounded-[20px] bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
            {section.code}
          </pre>
        ) : null}

        {section.children?.length ? (
          <div className="space-y-3">
            {section.children.map((child) => (
              <StandardSectionView key={child.id} section={child} depth={depth + 1} />
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
