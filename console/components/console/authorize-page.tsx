"use client";

import * as React from "react";
import { CheckCircle2, LogIn, ShieldAlert, XCircle } from "lucide-react";
import { ConnectionPanel } from "@/components/console/connection-panel";
import { PageFrame } from "@/components/layout/page-frame";
import { ReloadIconButton } from "@/components/layout/reload-icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConsoleConnection } from "@/hooks/use-console-connection";
import { useUserSession } from "@/hooks/use-user-session";
import {
  approveAuthorizationRequest,
  buildGitHubStartUrl,
  buildOidcStartUrl,
  denyAuthorizationRequest,
  fetchAuthMe,
  fetchAuthProviders,
  fetchAuthorizationRequest,
  type V2AuthProvider,
  type V2AuthorizationRequest,
} from "@/lib/api-v2";
import { formatDate } from "@/lib/console-utils";

const PENDING_USER_ID = "__pending__";

function isPendingUser(userId: string): boolean {
  return userId === PENDING_USER_ID;
}

export function AuthorizePage({ requestId }: { requestId: string }) {
  const { connection, draft, setDraft, saveDraft } = useConsoleConnection();
  const { session, syncSessionFromServer, isLoggedIn } = useUserSession();
  const [request, setRequest] = React.useState<V2AuthorizationRequest | null>(null);
  const [authProviders, setAuthProviders] = React.useState<V2AuthProvider[]>([]);
  const [selectedCapabilities, setSelectedCapabilities] = React.useState<string[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const syncCookieSession = React.useCallback(async () => {
    try {
      const me = await fetchAuthMe(connection);
      syncSessionFromServer({
        userId: me.user_id,
        expiresAt: me.expires_at,
      });
    } catch {
      // No active cookie session — user still needs to sign in.
    }
  }, [connection, syncSessionFromServer]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      await syncCookieSession();
      const response = await fetchAuthorizationRequest(connection, requestId);
      setRequest(response.authorization_request);
      setSelectedCapabilities(response.authorization_request.requested_capabilities);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load authorization request.");
    } finally {
      setLoading(false);
    }
  }, [connection, requestId, syncCookieSession]);

  React.useEffect(() => {
    void refresh();
    void fetchAuthProviders(connection)
      .then((response) => setAuthProviders(response.items))
      .catch(() => setAuthProviders([]));
  }, [connection, refresh]);

  function toggleCapability(name: string) {
    setSelectedCapabilities((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
    );
  }

  async function handleApprove() {
    if (!request) return;
    setErrorMessage("");
    setStatusMessage("");
    try {
      await approveAuthorizationRequest(connection, {
        authorization_request_id: request.id,
        granted_capabilities: selectedCapabilities,
      });
      setStatusMessage("Authorization approved. The agent can now invoke the granted capabilities.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Approval failed.");
    }
  }

  async function handleDeny() {
    if (!request) return;
    setErrorMessage("");
    setStatusMessage("");
    try {
      await denyAuthorizationRequest(connection, request.id);
      setStatusMessage("Authorization denied.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Deny failed.");
    }
  }

  const isPending = request?.status === "pending";
  const requestUserPending = request ? isPendingUser(request.user_id) : false;
  const canApprove =
    isPending &&
    isLoggedIn &&
    (requestUserPending || session?.userId === request?.user_id);

  const authorizeUrl = typeof window !== "undefined" ? window.location.href : `/authorize/${requestId}`;

  return (
    <PageFrame
      title="Authorize Agent"
      description="Review and approve the capabilities an agent is requesting. You never share tokens with the agent."
      actions={<ReloadIconButton onReload={() => void refresh()} disabled={loading} />}
    >
      <ConnectionPanel
        draft={draft}
        onDraftChange={setDraft}
        onApply={saveDraft}
        connection={connection}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
      />
      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</Card>
      ) : null}
      {statusMessage ? (
        <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{statusMessage}</Card>
      ) : null}

      {!request && !loading ? (
        <Card className="p-6 text-sm text-slate-500">Authorization request not found.</Card>
      ) : null}

      {request ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Card className="space-y-6 p-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-[color:var(--brand)]" />
                <h2 className="text-xl font-semibold">{request.agent_name}</h2>
                <Badge>{request.status}</Badge>
              </div>
              <p className="text-sm text-slate-600">
                wants access{" "}
                {requestUserPending ? (
                  <>on your behalf after you sign in</>
                ) : (
                  <>
                    on behalf of <strong>{request.user_id}</strong>
                  </>
                )}
              </p>
              <p className="text-xs text-slate-500">
                Expires {formatDate(request.expires_at)} · Request {request.id}
              </p>
              {request.reason ? <p className="text-sm text-slate-700">{request.reason}</p> : null}
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Requested capabilities</h3>
              {request.capabilities.map((capability) => {
                const checked = selectedCapabilities.includes(capability.name);
                return (
                  <label
                    key={capability.name}
                    className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${
                      checked ? "border-[color:var(--brand)] bg-[color:var(--brand)]/5" : "border-[color:var(--border)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      disabled={!isPending}
                      onChange={() => toggleCapability(capability.name)}
                    />
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{capability.name}</p>
                        <Badge>{capability.capability_type}</Badge>
                        <Badge>{capability.risk_level}</Badge>
                      </div>
                      <p className="text-sm text-slate-600">{capability.description}</p>
                      <p className="text-xs text-slate-500">
                        Scopes: {capability.scopes.join(", ") || "none"}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <h3 className="text-lg font-semibold">Decision</h3>
            <p className="text-sm text-slate-600">
              You authorize capabilities only. The agent never receives your GitHub token, session, or API keys.
            </p>
            {isPending ? (
              <div className="space-y-3">
                {!canApprove ? (
                  <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    <p className="font-medium">Sign in to approve</p>
                    <p className="mt-2 text-slate-700">
                      Use GitHub or another provider below. You will return to this page automatically.
                    </p>
                    {authProviders.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {authProviders.map((provider) => (
                          <Button
                            key={`${provider.type}:${provider.name}`}
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              if (provider.type === "github") {
                                window.location.href = buildGitHubStartUrl(connection, authorizeUrl);
                                return;
                              }
                              window.location.href = buildOidcStartUrl(
                                connection,
                                provider.name,
                                authorizeUrl,
                              );
                            }}
                          >
                            <LogIn className="mr-2 h-4 w-4" />
                            {provider.display_name}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                ) : (
                  <Card className="border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    Signed in as <strong>{session?.userId}</strong>
                  </Card>
                )}
                <Button
                  className="w-full"
                  disabled={!canApprove || selectedCapabilities.length === 0}
                  onClick={() => void handleApprove()}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Allow selected capabilities
                </Button>
                <Button className="w-full" variant="secondary" onClick={() => void handleDeny()}>
                  <XCircle className="mr-2 h-4 w-4" />
                  Deny request
                </Button>
              </div>
            ) : (
              <Card className="border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                This request is {request.status}.
                {request.granted_capabilities.length > 0 ? (
                  <p className="mt-2">Granted: {request.granted_capabilities.join(", ")}</p>
                ) : null}
                {!requestUserPending && request.status === "approved" ? (
                  <p className="mt-2">
                    Authorized user: <strong>{request.user_id}</strong>
                  </p>
                ) : null}
              </Card>
            )}
          </Card>
        </div>
      ) : null}
    </PageFrame>
  );
}
