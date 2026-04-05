import { Card } from "@/components/ui/card";
import { PageFrame } from "@/components/layout/page-frame";

export function ReadmePage({ readme }: { readme: string }) {
  return (
    <PageFrame
      title="README"
      description="Read the project overview, third-party integration guidance, privacy model, and deployment notes without leaving CNothing."
    >
      <Card className="overflow-hidden">
        <div className="border-b border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-950">Project document</h2>
          <p className="mt-1 text-sm text-slate-600">
            This page mirrors the repository README so operators and integrators can review the
            current contract directly from the console.
          </p>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap px-6 py-6 text-sm leading-7 text-slate-800">
          {readme}
        </pre>
      </Card>
    </PageFrame>
  );
}
