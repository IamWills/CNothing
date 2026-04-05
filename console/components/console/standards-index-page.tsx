import { ExternalLink, ShieldCheck } from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { publishedStandards } from "@/lib/auth-standard";

export function StandardsIndexPage() {
  return (
    <PageFrame
      title="CNothing Standards"
      description="Browse the published CNothing standards catalog, then open a fixed version when you need a stable protocol reference for implementation, review, or audit."
    >
      <section className="grid gap-4">
        {publishedStandards.map((standard) => (
          <Card key={standard.id} className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-[color:var(--surface-muted)] px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  <ShieldCheck className="h-4 w-4 text-[color:var(--brand)]" />
                  {standard.family}
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                    {standard.title}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-slate-600">{standard.summary}</p>
                </div>
              </div>
              <div className="grid gap-2 text-sm text-slate-600">
                <p>
                  <span className="font-medium text-slate-900">Version:</span> {standard.version}
                </p>
                <p>
                  <span className="font-medium text-slate-900">Status:</span> {standard.status}
                </p>
                <p>
                  <span className="font-medium text-slate-900">Published:</span> {standard.publishedAt}
                </p>
              </div>
            </div>

            <div className="rounded-[24px] bg-[color:var(--surface-muted)]/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Canonical path</p>
              <a
                href={standard.canonicalPath}
                className="mt-2 block break-all text-sm font-medium text-slate-700 underline decoration-slate-300 underline-offset-4"
              >
                {standard.canonicalPath}
              </a>
            </div>

            <div className="flex flex-wrap gap-3">
              <a href={standard.canonicalPath}>
                <Button>
                  Open standard
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </a>
              <a href={standard.exports.markdown}>
                <Button variant="secondary">
                  Markdown
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </a>
              <a href={standard.exports.html}>
                <Button variant="secondary">
                  HTML
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </a>
            </div>
          </Card>
        ))}
      </section>
    </PageFrame>
  );
}
