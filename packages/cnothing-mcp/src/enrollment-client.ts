import {
  readEnrollmentState,
  readEnvOrStoredToken,
  userVisibleEnrollment,
  writeEnrollmentState,
  writeStoredToken,
  type EnrollmentState,
} from "./credential-store";

const BASE_URL = (process.env.CNOTHING_BASE_URL ?? "https://cnothing.com").replace(/\/+$/, "");

function objectArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function enrollmentRequest(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}${path}`, init);
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  const record = objectArgs(data);
  if (!response.ok) {
    const error = objectArgs(record.error);
    throw new Error(
      typeof error.message === "string" ? error.message : `CNothing enrollment returned HTTP ${response.status}`,
    );
  }
  return record;
}

async function startEnrollment(): Promise<EnrollmentState> {
  const created = await enrollmentRequest("/v4/agent-enrollments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: process.env.CNOTHING_CLIENT_NAME?.trim() || "cnothing-mcp",
      software_id: "cnothing-mcp",
    }),
  });
  const state: EnrollmentState = {
    enrollment_id: String(created.enrollment_id ?? ""),
    enrollment_secret: String(created.enrollment_secret ?? ""),
    approval_url: String(created.approval_url ?? ""),
    user_code: String(created.user_code ?? ""),
    expires_at: String(created.expires_at ?? ""),
  };
  if (!state.enrollment_id || !state.enrollment_secret) {
    throw new Error("CNothing enrollment did not return a host credential");
  }
  await writeEnrollmentState(state);
  return state;
}

async function pollEnrollment(state: EnrollmentState): Promise<string | null> {
  const result = await enrollmentRequest(`/v4/agent-enrollments/${encodeURIComponent(state.enrollment_id)}`, {
    headers: { authorization: `Bearer ${state.enrollment_secret}` },
  });
  if (result.status === "approved" && typeof result.access_token === "string" && result.access_token) {
    await writeStoredToken(result.access_token);
    return result.access_token;
  }
  if (result.status === "denied" || result.status === "expired") {
    throw new Error(`CNothing agent enrollment ${String(result.status)}`);
  }
  return null;
}

/**
 * Resolve a host-held agent token. Returns a user-visible enrollment object
 * (no secrets) when pairing is still required.
 */
export async function resolveAgentToken(): Promise<
  { token: string } | { enrollment: ReturnType<typeof userVisibleEnrollment> }
> {
  const existing = await readEnvOrStoredToken();
  if (existing) return { token: existing };

  let state = await readEnrollmentState();
  if (!state) {
    state = await startEnrollment();
    return { enrollment: userVisibleEnrollment(state) };
  }

  const claimed = await pollEnrollment(state);
  if (claimed) return { token: claimed };
  return { enrollment: userVisibleEnrollment(state) };
}
