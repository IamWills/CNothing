"use client";

import * as React from "react";
import { BookKey, Sparkles, Wrench } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { fetchMcpCatalog, fetchSkills, type McpResource, type McpTool, type SkillEntry } from "@/lib/api";
import { formatJson } from "@/lib/console-utils";

export function CatalogPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const [tools, setTools] = React.useState<McpTool[]>([]);
  const [resources, setResources] = React.useState<McpResource[]>([]);
  const [skills, setSkills] = React.useState<SkillEntry[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const refreshCatalog = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const [mcpResponse, skillsResponse] = await Promise.all([
        fetchMcpCatalog(connection),
        fetchSkills(connection),
      ]);

      setTools(mcpResponse.tools);
      setResources(mcpResponse.resources);
      setSkills(skillsResponse.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load catalog data.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  return (
    <PageFrame
      title="Catalog"
      description="Browse the MCP tool contracts, public resources, and skill markdown that CNothing exposes to humans and AI agents."
      actions={
        <ReloadIconButton onReload={() => void refreshCatalog()} disabled={loading} />
      }
    >
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
        errorMessage={errorMessage}
      />

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-[color:var(--system-blue)]" />
            <h2 className="text-lg font-semibold">MCP tools</h2>
          </div>
          <div className="grid gap-3">
            {tools.map((tool) => (
              <div
                key={tool.name}
                className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{tool.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">{tool.description}</p>
                  </div>
                  <Badge>{Object.keys(tool.inputSchema.properties ?? {}).length} inputs</Badge>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-[20px] bg-slate-950 px-4 py-3 text-xs text-slate-100">
                  {formatJson(tool.inputSchema)}
                </pre>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-4">
          <Card className="space-y-4">
            <div className="flex items-center gap-2">
              <BookKey className="h-4 w-4 text-[color:var(--brand)]" />
              <h2 className="text-lg font-semibold">MCP resources</h2>
            </div>
            <div className="space-y-3">
              {resources.map((resource) => (
                <div
                  key={resource.uri}
                  className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{resource.name}</span>
                    <Badge>{resource.mimeType}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{resource.description}</p>
                  <p className="mt-2 break-all text-xs text-slate-500">{resource.uri}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[color:var(--brand)]" />
              <h2 className="text-lg font-semibold">Skills</h2>
            </div>
            <div className="space-y-3">
              {skills.map((skill) => (
                <details
                  key={skill.id}
                  className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]/70 p-4"
                >
                  <summary className="list-none">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-medium">{skill.name}</h3>
                        <p className="mt-1 text-sm text-slate-600">{skill.description}</p>
                      </div>
                      <Badge>{skill.file_path}</Badge>
                    </div>
                  </summary>
                  <pre className="mt-3 overflow-x-auto rounded-[20px] bg-slate-950 px-4 py-3 text-xs text-slate-100">
                    {skill.body_markdown}
                  </pre>
                </details>
              ))}
            </div>
          </Card>
        </div>
      </section>
    </PageFrame>
  );
}
