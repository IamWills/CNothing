import { matchAllowedHost } from "./proxy.rules";

/**
 * A Mandate is delegated authority granted by a principal to an agent.
 * Grant is the current stored representation (`proxy_grants`) and the v4 API name.
 */
export type MandatePrincipalType = "user" | "organization" | "service_account" | "team";

export type MandatePrincipal = {
  type: MandatePrincipalType;
  id: string;
};

/**
 * Extensible constraint envelope. Unknown keys must be ignored: a later phase
 * may add max_amount / allowed_actions, but until a mandate opts into them
 * they have no effect on HTTP proxy evaluation.
 */
export type MandateConstraints = {
  hosts: string[];
  methods: string[];
  expires_at: string | null;
};

export type MandateStatus = "active" | "revoked";

export type Mandate = {
  id: string;
  principal: MandatePrincipal;
  agent_id: string;
  connection_id: string;
  provider_id: string;
  hosts: string[];
  methods: string[];
  actions: string[];
  constraints: MandateConstraints;
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  status: MandateStatus;
  last_used_at: string | null;
};

export type GrantRow = {
  id: string;
  agent_id: string;
  user_id: string;
  connection_id: string;
  provider_id: string;
  allowed_hosts: string[];
  allowed_methods: string[];
  status: MandateStatus;
  expires_at: string | null;
  last_used_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  principal_type?: string | null;
  principal_id?: string | null;
  constraints?: unknown;
  actions?: unknown;
  revoked_at?: string | null;
};

export type MandateConstraintDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      error_code: "grant_revoked" | "grant_expired" | "method_not_allowed" | "host_not_allowed";
      allowed_hosts?: string[];
      allowed_methods?: string[];
    };

export function buildMandateConstraints(input: {
  hosts: string[];
  methods: string[];
  expires_at?: string | null;
}): MandateConstraints {
  return {
    hosts: input.hosts,
    methods: input.methods,
    expires_at: input.expires_at ?? null,
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Prefer the constraints document; fall back to the original grant columns so
 * rows written before the Mandate migration still evaluate correctly.
 */
export function resolveMandateConstraints(row: GrantRow): MandateConstraints {
  const stored = isRecord(row.constraints) ? row.constraints : {};
  const hosts = asStringArray(stored.hosts);
  const methods = asStringArray(stored.methods);
  return {
    hosts: hosts.length > 0 ? hosts : row.allowed_hosts,
    methods: methods.length > 0 ? methods : row.allowed_methods,
    expires_at:
      "expires_at" in stored
        ? typeof stored.expires_at === "string"
          ? stored.expires_at
          : null
        : row.expires_at,
  };
}

export function mandateFromGrantRow(row: GrantRow): Mandate {
  const constraints = resolveMandateConstraints(row);
  const principalId = row.principal_id?.trim() || row.user_id;
  const principalType = (row.principal_type?.trim() || "user") as MandatePrincipalType;
  return {
    id: row.id,
    principal: { type: principalType, id: principalId },
    agent_id: row.agent_id,
    connection_id: row.connection_id,
    provider_id: row.provider_id,
    hosts: constraints.hosts,
    methods: constraints.methods,
    actions: asStringArray(row.actions),
    constraints,
    issued_at: row.created_at,
    expires_at: constraints.expires_at,
    revoked_at: row.revoked_at ?? null,
    status: row.status,
    last_used_at: row.last_used_at,
  };
}

export function toGrantPublic(mandate: Mandate) {
  return {
    id: mandate.id,
    agent_id: mandate.agent_id,
    connection_id: mandate.connection_id,
    provider_id: mandate.provider_id,
    allowed_hosts: mandate.hosts,
    allowed_methods: mandate.methods,
    status: mandate.status,
    expires_at: mandate.expires_at,
    last_used_at: mandate.last_used_at,
    created_at: mandate.issued_at,
    principal: mandate.principal,
    constraints: mandate.constraints,
    actions: mandate.actions,
    issued_at: mandate.issued_at,
    revoked_at: mandate.revoked_at,
  };
}

export function mandateIsRevokedOrExpired(
  mandate: Mandate,
  now: Date = new Date(),
): Extract<MandateConstraintDecision, { allowed: false }> | null {
  if (mandate.status !== "active" || mandate.revoked_at) {
    return { allowed: false, reason: "Grant has been revoked", error_code: "grant_revoked" };
  }
  const expiresAt = mandate.constraints.expires_at ?? mandate.expires_at;
  if (expiresAt && new Date(expiresAt).getTime() < now.getTime()) {
    return { allowed: false, reason: "Grant has expired", error_code: "grant_expired" };
  }
  return null;
}

export function evaluateMandateForRequest(input: {
  mandate: Mandate;
  method: string;
  host: string;
  now?: Date;
}): MandateConstraintDecision {
  const inactive = mandateIsRevokedOrExpired(input.mandate, input.now);
  if (inactive) {
    return inactive;
  }

  const method = input.method.trim().toUpperCase();
  if (!input.mandate.constraints.methods.includes(method)) {
    return {
      allowed: false,
      reason: `Method not allowed by grant: ${method}`,
      error_code: "method_not_allowed",
      allowed_methods: input.mandate.constraints.methods,
    };
  }

  if (!matchAllowedHost(input.host, input.mandate.constraints.hosts)) {
    return {
      allowed: false,
      reason: `Host not allowed by grant: ${input.host}`,
      error_code: "host_not_allowed",
      allowed_hosts: input.mandate.constraints.hosts,
    };
  }

  return { allowed: true };
}
