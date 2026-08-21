"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConsoleConnection } from "@/lib/api";

type ConnectionDraft = {
  baseUrl: string;
};

export function ConnectionPanel({
  draft,
  onDraftChange,
  onApply,
  connection,
  statusMessage,
  errorMessage,
  successMessage,
}: {
  draft: ConnectionDraft;
  onDraftChange: (next: ConnectionDraft) => void;
  onApply: () => void;
  connection: ConsoleConnection;
  statusMessage?: string;
  errorMessage?: string;
  successMessage?: string;
}) {
  return (
    <Card>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">CNothing instance</h2>
          <p className="mt-1 text-sm text-slate-500">
            This console talks to the same origin. Sign in at /login with a Human session.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="base-url">Base URL</Label>
            <Input id="base-url" value={draft.baseUrl} readOnly />
          </div>
          <Button onClick={onApply}>Use this origin</Button>
        </div>
        <div className="rounded-[20px] bg-[color:var(--surface-muted)]/70 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Active origin</p>
          <p className="mt-1 text-sm font-medium text-slate-700">{connection.baseUrl}</p>
        </div>
        {statusMessage ? (
          <p className="rounded-[20px] bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {statusMessage}
          </p>
        ) : null}
        {errorMessage ? (
          <p className="rounded-[20px] bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </p>
        ) : null}
        {successMessage ? (
          <p className="rounded-[20px] bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {successMessage}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
