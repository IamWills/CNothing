const HOST_SECRET = /enrs_[A-Za-z0-9._-]+|agent_[A-Za-z0-9._-]+/;

export function containsHostSecret(value: unknown): boolean {
  return HOST_SECRET.test(JSON.stringify(value));
}

export function assertModelSafe(value: unknown): void {
  if (containsHostSecret(value)) {
    throw new Error("Refusing to return host secrets to the model");
  }
}

export function renderModelJson(value: unknown): string {
  assertModelSafe(value);
  return JSON.stringify(value, null, 2);
}

export function userVisibleEnrollment(state: {
  approval_url: string;
  user_code: string;
  expires_at: string;
  retry_after_seconds?: number;
}): import("./types").EnrollmentRequired {
  const visible = {
    ok: false as const,
    status: "enrollment_required" as const,
    next_action: "wait_for_user" as const,
    retry_after_seconds: state.retry_after_seconds ?? 5,
    user_action: {
      message:
        "Open this CNothing URL and confirm the pairing code matches. Do not paste any token into chat.",
      approval_url: state.approval_url,
      user_code: state.user_code,
    },
    expires_at: state.expires_at,
  };
  assertModelSafe(visible);
  return visible;
}
