import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card } from "@/components/ui/card";
import { PageFrame } from "@/components/layout/page-frame";

const REPOSITORY_WEB_URL = "https://github.com/IamWills/CNothing";

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
        <div className="px-6 py-6">
          <article className="space-y-6 text-sm leading-7 text-slate-800">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ node: _node, ...props }) => (
                  <h1 className="text-4xl font-semibold tracking-tight text-slate-950" {...props} />
                ),
                h2: ({ node: _node, ...props }) => (
                  <h2
                    className="mt-10 border-t border-[color:var(--border)] pt-8 text-2xl font-semibold tracking-tight text-slate-950"
                    {...props}
                  />
                ),
                h3: ({ node: _node, ...props }) => (
                  <h3 className="mt-8 text-xl font-semibold tracking-tight text-slate-950" {...props} />
                ),
                h4: ({ node: _node, ...props }) => (
                  <h4 className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500" {...props} />
                ),
                p: ({ node: _node, ...props }) => <p className="text-sm leading-7 text-slate-700" {...props} />,
                ul: ({ node: _node, ...props }) => <ul className="list-disc space-y-2 pl-6 text-slate-700" {...props} />,
                ol: ({ node: _node, ...props }) => <ol className="list-decimal space-y-2 pl-6 text-slate-700" {...props} />,
                li: ({ node: _node, ...props }) => <li className="pl-1" {...props} />,
                a: ({ node: _node, href, ...props }) => (
                  <a
                    href={resolveReadmeHref(href)}
                    className="font-medium text-[color:var(--brand)] underline decoration-[color:var(--brand)]/35 underline-offset-4"
                    target="_blank"
                    rel="noreferrer"
                    title={resolveReadmeHref(href)}
                    {...props}
                  />
                ),
                blockquote: ({ node: _node, ...props }) => (
                  <blockquote
                    className="rounded-r-[20px] border-l-4 border-[color:var(--brand)] bg-[color:var(--surface-muted)]/80 px-5 py-3 text-slate-600"
                    {...props}
                  />
                ),
                code: ({ node: _node, className, children, ...props }) => {
                  const isBlock = className?.includes("language-");

                  if (isBlock) {
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  }

                  return (
                    <code
                      className="rounded-md bg-[color:var(--surface-muted)] px-1.5 py-0.5 font-mono text-[0.9em] text-slate-900"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                pre: ({ node: _node, ...props }) => (
                  <pre
                    className="overflow-x-auto rounded-[24px] bg-slate-950 px-5 py-4 text-xs leading-6 text-slate-100"
                    {...props}
                  />
                ),
                table: ({ node: _node, ...props }) => (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-[24px] border border-[color:var(--border)]" {...props} />
                  </div>
                ),
                thead: ({ node: _node, ...props }) => <thead className="bg-slate-950 text-slate-100" {...props} />,
                tbody: ({ node: _node, ...props }) => <tbody className="bg-white" {...props} />,
                tr: ({ node: _node, ...props }) => <tr className="even:bg-[color:var(--surface-muted)]/45" {...props} />,
                th: ({ node: _node, ...props }) => <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em]" {...props} />,
                td: ({ node: _node, ...props }) => <td className="border-t border-[color:var(--border)] px-4 py-3 align-top text-sm text-slate-700" {...props} />,
                hr: ({ node: _node, ...props }) => <hr className="border-none border-t border-[color:var(--border)]" {...props} />,
              }}
            >
              {readme}
            </ReactMarkdown>
          </article>
        </div>
      </Card>
    </PageFrame>
  );
}

function resolveReadmeHref(href?: string) {
  if (!href) {
    return href;
  }

  if (href.startsWith("./") || href.startsWith("../")) {
    const normalized = href.replace(/^\.\//, "");
    const repositoryPath = normalized.replace(/\/$/, "");
    const isDirectoryLike =
      href.endsWith("/") || !repositoryPath.includes(".") || repositoryPath === "deploy";

    return isDirectoryLike
      ? `${REPOSITORY_WEB_URL}/tree/main/${repositoryPath}`
      : `${REPOSITORY_WEB_URL}/blob/main/${repositoryPath}`;
  }

  return href;
}
