import { ForbiddenError, ValidationError } from "../utils/errors";
import type { AgentRecord } from "../v2/v2.entity";

const TENANT_HEADER = "x-cnothing-tenant";

export function normalizeTenantId(value: string | null | undefined): string {
  const tenant = value?.trim();
  if (!tenant) {
    return "default";
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(tenant)) {
    throw new ValidationError("Invalid tenant_id format", { error_code: "invalid_tenant_id" });
  }
  return tenant;
}

export function readTenantFromRequest(request: Request): string {
  const header = request.headers.get(TENANT_HEADER);
  if (header?.trim()) {
    return normalizeTenantId(header);
  }
  return "default";
}

export function assertAgentTenant(agent: AgentRecord, tenantId?: string | null): void {
  const expected = normalizeTenantId(tenantId ?? agent.tenant_id);
  const actual = normalizeTenantId(agent.tenant_id);
  if (expected !== actual) {
    throw new ForbiddenError("Agent tenant mismatch", {
      error_code: "tenant_mismatch",
      expected_tenant: expected,
      agent_tenant: actual,
    });
  }
}

export function assertResourceTenant(input: {
  agent: AgentRecord;
  resourceTenantId?: string | null;
  resourceLabel?: string;
}): void {
  const agentTenant = normalizeTenantId(input.agent.tenant_id);
  const resourceTenant = normalizeTenantId(input.resourceTenantId);
  if (agentTenant !== resourceTenant) {
    throw new ForbiddenError(`${input.resourceLabel ?? "Resource"} tenant mismatch`, {
      error_code: "tenant_mismatch",
      agent_tenant: agentTenant,
      resource_tenant: resourceTenant,
    });
  }
}

export function resolveConnectionTenant(input: {
  request: Request;
  explicitTenantId?: string;
}): string {
  if (input.explicitTenantId?.trim()) {
    return normalizeTenantId(input.explicitTenantId);
  }
  return readTenantFromRequest(input.request);
}
