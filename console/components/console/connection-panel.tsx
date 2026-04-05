"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ConsoleConnection } from "@/lib/api";

type ConnectionDraft = {
  baseUrl: string;
  adminToken: string;
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
          <h2 className="text-lg font-semibold">Connection</h2>
          <p className="mt-1 text-sm text-slate-500">
            Point the console at any deployed CNothing instance and optionally provide the
            admin bearer token.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="base-url">CNothing base URL</Label>
            <Input
              id="base-url"
              value={draft.baseUrl}
              onChange={(event) =>
                onDraftChange({ ...draft, baseUrl: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-token">Admin bearer token</Label>
            <Input
              id="admin-token"
              type="password"
              value={draft.adminToken}
              onChange={(event) =>
                onDraftChange({ ...draft, adminToken: event.target.value })
              }
              placeholder="Optional unless KEYSERVICE_BEARER_TOKEN is configured"
            />
          </div>
          <Button onClick={onApply}>Apply connection</Button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-[20px] bg-[color:var(--surface-muted)]/70 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Active base URL</p>
            <p className="mt-1 text-sm font-medium text-slate-700">{connection.baseUrl}</p>
          </div>
          <div className="rounded-[20px] bg-[color:var(--surface-muted)]/70 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Admin access</p>
            <p className="mt-1 text-sm font-medium text-slate-700">
              {connection.adminToken ? "Bearer token attached" : "Read-only until a token is set"}
            </p>
          </div>
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
