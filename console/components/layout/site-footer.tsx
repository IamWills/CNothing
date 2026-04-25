import { brand } from "@/lib/brand";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[color:var(--border)]/70 bg-white/75 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-6 text-sm text-slate-600 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {brand.name}. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a className="hover:text-slate-900" href="mailto:hello@cnothing.com">
              Contact
            </a>
            <a className="hover:text-slate-900" href="https://github.com/IamWills/CNothing" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </div>
        <p>
          Privacy notice: this site may process request metadata and operational logs for security, abuse prevention,
          and service reliability. Do not submit regulated or highly sensitive personal data unless you have legal
          authorization.
        </p>
        <p>
          Security and legal disclaimer: information and examples are provided as-is without warranty. You remain
          responsible for key management, credential handling, access control, and compliance with applicable laws.
        </p>
      </div>
    </footer>
  );
}
