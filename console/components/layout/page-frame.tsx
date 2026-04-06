import type { ReactNode } from "react";

export function PageFrame({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-140px)] w-full max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="flex flex-col gap-4 rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,rgba(51,22,15,0.96),rgba(136,45,23,0.88)_42%,rgba(252,242,238,0.94)_100%)] px-6 py-8 text-white shadow-[0_24px_90px_rgba(125,49,21,0.16)] sm:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="text-sm text-slate-200 sm:text-base">{description}</p>
          </div>
          {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
        </div>
      </section>

      {children}
    </main>
  );
}
