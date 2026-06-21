"use client";

import * as React from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { PageFrame } from "@/components/layout/page-frame";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import {
  buildGitHubStartUrl,
  buildOidcStartUrl,
  fetchAuthMe,
  fetchAuthProviders,
  issueLoginToken,
  loginUser,
  type V2AuthProvider,
} from "@/lib/api-v2";

export function LoginPage() {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { session, saveSession, syncSessionFromServer, clearSession, isLoggedIn } = useUserSession();
  const [form, setForm] = React.useState({ user_id: "user123", login_token: "" });
  const [authProviders, setAuthProviders] = React.useState<V2AuthProvider[]>([]);
  const [issuedToken, setIssuedToken] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    void fetchAuthMe(connection)
      .then((response) => {
        syncSessionFromServer({
          userId: response.user_id,
          expiresAt: response.expires_at,
        });
        setStatusMessage(`Signed in as ${response.user_id}.`);
      })
      .catch(() => {
        // Legacy fallback: session_token in URL from older redirects.
        const params = new URLSearchParams(window.location.search);
        const sessionToken = params.get("session_token")?.trim();
        const userId = params.get("user_id")?.trim();
        if (sessionToken && userId) {
          saveSession({
            sessionToken,
            userId,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
          setStatusMessage(`Signed in as ${userId}.`);
          window.history.replaceState({}, "", "/login");
        }
      });
  }, [connection, saveSession, syncSessionFromServer]);

  React.useEffect(() => {
    void fetchAuthProviders(connection)
      .then((response) => setAuthProviders(response.items))
      .catch(() => setAuthProviders([]));
  }, [connection]);

  async function handleIssueToken() {
    setErrorMessage("");
    setStatusMessage("");
    setIssuedToken(null);
    try {
      const response = await issueLoginToken(connection, form.user_id);
      setIssuedToken(response.login_token);
      setForm((prev) => ({ ...prev, login_token: response.login_token }));
      setStatusMessage("One-time login token issued. Sign in within 15 minutes.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to issue login token.");
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await loginUser(connection, {
        user_id: form.user_id,
        login_token: form.login_token,
      });
      saveSession({
        sessionToken: response.session_token,
        userId: response.user_id,
        expiresAt: response.expires_at,
      });
      syncSessionFromServer({
        userId: response.user_id,
        expiresAt: response.expires_at,
        sessionToken: response.session_token,
      });
      setStatusMessage(`Signed in as ${response.user_id}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageFrame
      title="User Sign In"
      description="Sign in with GitHub, OIDC, or a one-time login token to approve agent authorization requests and high-risk capability confirmations."
    >
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Sign in</h2>
          </div>
          <form className="space-y-4" onSubmit={(event) => void handleLogin(event)}>
            <div className="space-y-2">
              <Label htmlFor="user-id">User ID</Label>
              <Input
                id="user-id"
                value={form.user_id}
                onChange={(event) => setForm((prev) => ({ ...prev, user_id: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-token">Login token</Label>
              <Input
                id="login-token"
                value={form.login_token}
                onChange={(event) => setForm((prev) => ({ ...prev, login_token: event.target.value }))}
                placeholder="login_..."
                required
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={loading}>
                Sign in
              </Button>
              <Button type="button" variant="secondary" onClick={() => void handleIssueToken()}>
                Issue token (admin)
              </Button>
            </div>
          </form>

          {authProviders.length > 0 ? (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <p className="text-sm font-medium text-slate-700">Sign in with identity provider</p>
              <div className="flex flex-wrap gap-2">
                {authProviders.map((provider) => (
                  <Button
                    key={`${provider.type}:${provider.name}`}
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const redirectAfter = `${window.location.origin}/login`;
                      if (provider.type === "github") {
                        window.location.href = buildGitHubStartUrl(connection, redirectAfter);
                        return;
                      }
                      window.location.href = buildOidcStartUrl(connection, provider.name, redirectAfter);
                    }}
                  >
                    {provider.display_name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {issuedToken ? (
            <Card className="border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
              <p className="font-medium">One-time login token</p>
              <code className="mt-2 block break-all">{issuedToken}</code>
            </Card>
          ) : null}
        </Card>

        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[color:var(--brand)]" />
            <h2 className="text-lg font-semibold">Current session</h2>
          </div>
          {isLoggedIn && session ? (
            <div className="space-y-3 text-sm">
              <p>
                Signed in as <strong>{session.userId}</strong>
              </p>
              <p className="text-slate-600">Expires: {session.expiresAt}</p>
              <Button variant="secondary" onClick={() => clearSession()}>
                Sign out
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              User sessions replace admin bearer tokens for authorization approvals. Agents still use
              their own access tokens to invoke capabilities.
            </p>
          )}
        </Card>
      </div>
    </PageFrame>
  );
}
