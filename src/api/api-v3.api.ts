import { requireAdminAccess } from "../admin/admin-auth";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors";
import { parseJsonBody } from "../utils/http";
import { readOptionalObject, requireAgentFromRequest } from "../v2/agent-auth";
import { oauthConnectionService, oauthProviderService } from "../v2/oauth-connection.service";
import { sanitizeAgentResponse } from "../v2/secret-redaction";
import { requireUserSession } from "../v2/user-session";
import {
  findCapabilityById,
  findCapabilityByName,
  listCapabilities,
  listPolicies,
} from "../v2/v2.repository";
import { pool } from "../db";
import { capabilityInvocationGateway } from "../v3/invocation/capability-invocation.gateway";
import { approvalEngine } from "../v3/approval-engine/approval-engine";
import {
  createCapabilityPermission,
  findApprovalById,
  findApprovalByToken,
  listAllCapabilityPermissions,
  listApprovals,
} from "../v3/gateway.repository";
import { secretVaultService } from "../v3/secret-vault.service";
import type { JsonObject } from "../v2/v2.entity";

function inferBaseUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("Host") || requestUrl.host;
  const proto = forwardedProto || requestUrl.protocol.replace(/:$/, "") || "http";
  return `${proto}://${host}`;
}

function publicCapabilityView(cap: Awaited<ReturnType<typeof listCapabilities>>[number]) {
  return {
    id: cap.id,
    name: cap.name,
    display_name: cap.display_name,
    description: cap.description,
    provider: cap.provider,
    provider_id: cap.provider_id,
    input_schema: cap.input_schema,
    output_schema: cap.output_schema,
    required_scopes: cap.scopes,
    execution_type: cap.execution_type,
    risk_level: cap.risk_level,
    approval_policy: cap.approval_policy,
    owner_user_id: cap.owner_user_id,
    status: cap.status,
    created_at: cap.created_at,
    updated_at: cap.updated_at,
  };
}

export async function handleApiV3Request(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith("/api/v3")) {
    return null;
  }

  // OpenAPI
  if (request.method === "GET" && (path === "/api/v3/openapi.json" || path === "/api/v3/openapi")) {
    return serveApiV3OpenApi(request);
  }

  // Providers
  if (request.method === "GET" && path === "/api/v3/providers") {
    const providers = await oauthProviderService.listPublicProviders();
    return Response.json(sanitizeAgentResponse({ ok: true, items: providers }));
  }

  if (request.method === "POST" && path === "/api/v3/providers") {
    await requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const created = await oauthProviderService.createProvider({
      slug: String(body.slug ?? ""),
      display_name: String(body.display_name ?? body.name ?? body.slug ?? ""),
      auth_type: body.auth_type === "oidc" ? "oidc" : "oauth2",
      authorization_url: typeof body.authorization_url === "string" ? body.authorization_url : "",
      token_url: typeof body.token_url === "string" ? body.token_url : "",
      client_id: typeof body.client_id === "string" ? body.client_id : undefined,
      client_secret: typeof body.client_secret === "string" ? body.client_secret : undefined,
      default_scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [],
      discovery_url: typeof body.discovery_url === "string" ? body.discovery_url : undefined,
      issuer: typeof body.issuer === "string" ? body.issuer : undefined,
    });
    return Response.json(sanitizeAgentResponse({ ok: true, provider: created }), { status: 201 });
  }

  // OAuth connect
  if (request.method === "POST" && path === "/api/v3/oauth/connect") {
    const session = await requireUserSession(request);
    const body = await parseJsonBody(request);
    const provider =
      typeof body.provider === "string"
        ? body.provider
        : typeof body.provider_slug === "string"
          ? body.provider_slug
          : "github";
    const result = await oauthConnectionService.startConnect({
      userId: session.user_id,
      providerSlug: provider,
      apiBaseUrl: inferBaseUrl(request),
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
    });
    return Response.json(sanitizeAgentResponse({ ...result, ok: true }));
  }

  // Capabilities list
  if (request.method === "GET" && path === "/api/v3/capabilities") {
    const items = await listCapabilities();
    return Response.json(
      sanitizeAgentResponse({
        ok: true,
        items: items.filter((c) => !c.deleted_at).map(publicCapabilityView),
      }),
    );
  }

  // Capability invoke: POST /api/v3/capabilities/:id/invoke
  {
    const invokeMatch = path.match(/^\/api\/v3\/capabilities\/([^/]+)\/invoke$/);
    if (request.method === "POST" && invokeMatch) {
      const agent = await requireAgentFromRequest(request);
      const capabilityId = decodeURIComponent(invokeMatch[1]!);
      const body = await parseJsonBody(request);

      if (typeof body.agent_id === "string" && body.agent_id !== agent.id) {
        throw new ForbiddenError("agent_id does not match authenticated agent", {
          error_code: "agent_mismatch",
        });
      }

      const response = await capabilityInvocationGateway.invoke({
        agent,
        capability_id: capabilityId,
        user_id: typeof body.user_id === "string" ? body.user_id : undefined,
        payload: readOptionalObject(body, "input") as JsonObject,
        idempotency_key:
          typeof body.idempotency_key === "string" ? body.idempotency_key : undefined,
        dry_run: Boolean(body.dry_run),
        approval_id: typeof body.approval_id === "string" ? body.approval_id : undefined,
        timeout_ms:
          typeof body.timeout_ms === "number" && body.timeout_ms > 0
            ? body.timeout_ms
            : undefined,
        request,
      });

      const status =
        response.status === "pending_approval"
          ? 202
          : response.status === "denied"
            ? 403
            : response.status === "reconnect_required"
              ? 409
              : response.status === "failed"
                ? 400
                : 200;

      return Response.json(sanitizeAgentResponse(response), { status });
    }
  }

  // Approvals
  if (request.method === "GET" && path === "/api/v3/approvals") {
    const session = await requireUserSession(request);
    const status = url.searchParams.get("status") as
      | "pending"
      | "approved"
      | "rejected"
      | "expired"
      | undefined;
    const items = await listApprovals({
      user_id: session.user_id,
      status: status || undefined,
      limit: 100,
    });
    return Response.json(
      sanitizeAgentResponse({
        ok: true,
        items: items.map((a) => ({
          approval_id: a.id,
          status: a.status,
          capability_id: a.capability_id,
          agent_id: a.agent_id,
          execution_id: a.execution_id,
          policy_id: a.policy_id,
          safe_summary: a.safe_input_summary ?? a.input_summary,
          risk_level: a.risk_level,
          scopes: a.scopes,
          resource_key: a.resource_key,
          expires_at: a.expires_at,
          approved_at: a.approved_at,
          rejected_at: a.rejected_at,
          cancelled_at: a.cancelled_at,
          created_at: a.created_at,
        })),
      }),
    );
  }

  {
    const approvalMatch = path.match(/^\/api\/v3\/approvals\/([^/]+)$/);
    if (request.method === "GET" && approvalMatch) {
      const approvalId = decodeURIComponent(approvalMatch[1]!);
      // Agent or user can poll status (no secrets)
      try {
        await requireAgentFromRequest(request);
      } catch {
        await requireUserSession(request);
      }
      const status = await approvalEngine.getApprovalStatus(approvalId);
      if (!status) throw new NotFoundError("Approval not found");
      return Response.json(sanitizeAgentResponse({ ok: true, ...status }));
    }
  }

  {
    const decideMatch = path.match(/^\/api\/v3\/approvals\/([^/]+)\/decide$/);
    if (request.method === "POST" && decideMatch) {
      const approvalId = decodeURIComponent(decideMatch[1]!);
      const body = await parseJsonBody(request);
      const decision =
        body.decision === "approved" || body.decision === "rejected"
          ? body.decision
          : body.approve === true
            ? "approved"
            : body.approve === false
              ? "rejected"
              : null;
      if (!decision) {
        throw new ValidationError("decision must be 'approved' or 'rejected'");
      }

      let decidedBy: string;
      const token = typeof body.token === "string" ? body.token : url.searchParams.get("token");
      if (token) {
        const byToken = await findApprovalByToken(token);
        if (!byToken || byToken.id !== approvalId) {
          throw new ForbiddenError("Invalid approval token", { error_code: "invalid_token" });
        }
        decidedBy = byToken.user_id;
      } else {
        const session = await requireUserSession(request);
        const approval = await findApprovalById(approvalId);
        if (!approval || approval.user_id !== session.user_id) {
          throw new ForbiddenError("Not allowed to decide this approval");
        }
        decidedBy = session.user_id;
      }

      const updated = await approvalEngine.decide({
        approval_id: approvalId,
        decision,
        decided_by: decidedBy,
      });
      if (!updated) throw new NotFoundError("Approval not found or already decided");

      // Auto-resume execution after approval
      let execution_result: unknown = null;
      if (decision === "approved") {
        try {
          const { findAgentById } = await import("../v2/v2.repository");
          const agent = await findAgentById(updated.agent_id);
          if (agent) {
            const snapshot = approvalEngine.getInputSnapshot(updated);
            execution_result = await capabilityInvocationGateway.invoke({
              agent,
              capability_id: updated.capability_id,
              user_id: updated.user_id,
              payload: snapshot,
              approval_id: updated.id,
              request,
            });
          }
        } catch (err) {
          execution_result = {
            status: "failed",
            error: {
              code: "resume_failed",
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }

      return Response.json(
        sanitizeAgentResponse({
          ok: true,
          approval_id: updated.id,
          status: updated.status,
          execution: execution_result,
        }),
      );
    }
  }

  // Executions list
  if (request.method === "GET" && path === "/api/v3/executions") {
    let userId: string | undefined;
    try {
      const session = await requireUserSession(request);
      userId = session.user_id;
    } catch {
      await requireAdminAccess(request);
    }
    const { listExecutions } = await import("../v3/gateway.repository");
    const items = await listExecutions({
      user_id: userId,
      status: (url.searchParams.get("status") as never) || undefined,
      limit: Math.min(Number(url.searchParams.get("limit") ?? "50"), 200),
    });
    return Response.json(
      sanitizeAgentResponse({
        ok: true,
        items: items.map((e) => ({
          execution_id: e.id,
          status: e.status,
          capability_id: e.capability_id,
          agent_id: e.agent_id,
          approval_id: e.approval_id,
          policy_decision: e.policy_decision,
          worker_type: e.worker_type,
          audit_chain_id: e.audit_chain_id,
          error_code: e.error_code,
          dry_run: e.dry_run,
          started_at: e.started_at,
          completed_at: e.completed_at ?? e.finished_at,
        })),
      }),
    );
  }

  // Executions
  {
    const execMatch = path.match(/^\/api\/v3\/executions\/([^/]+)$/);
    if (request.method === "GET" && execMatch) {
      await requireAgentFromRequest(request).catch(() => requireUserSession(request));
      const execution = await capabilityInvocationGateway.getExecution(
        decodeURIComponent(execMatch[1]!),
      );
      if (!execution) throw new NotFoundError("Execution not found");
      return Response.json(sanitizeAgentResponse({ ok: true, ...execution }));
    }
  }

  // Audit chain view
  {
    const chainMatch = path.match(/^\/api\/v3\/audit\/chains\/([^/]+)$/);
    if (request.method === "GET" && chainMatch) {
      await requireUserSession(request).catch(() => requireAdminAccess(request));
      const { getAuditChain, verifyAuditChain } = await import("../v3/audit/audit-chain");
      const chainId = decodeURIComponent(chainMatch[1]!);
      const events = await getAuditChain(chainId);
      const integrity = verifyAuditChain(events);
      return Response.json(
        sanitizeAgentResponse({
          ok: true,
          audit_chain_id: chainId,
          integrity,
          events: events.map((e) => ({
            id: e.id,
            sequence_no: e.sequence_no,
            event_type: e.event_type,
            prev_hash: e.prev_hash,
            chain_hash: e.chain_hash,
            execution_id: e.execution_id,
            approval_id: e.approval_id,
            result: e.result,
            input_summary: e.input_summary,
            risk_level: e.risk_level,
            created_at: e.created_at,
          })),
        }),
      );
    }
  }

  // Audit
  if (request.method === "GET" && path === "/api/v3/audit") {
    await requireUserSession(request).catch(() => requireAdminAccess(request));
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
    const chainId = url.searchParams.get("audit_chain_id");
    const result = await pool.query(
      chainId
        ? `
          SELECT id, event_type, agent_id, user_id, capability_id, execution_id,
                 approval_id, ip, user_agent, input_summary, risk_level, result,
                 result_hash, metadata, created_at, audit_chain_id, sequence_no,
                 prev_hash, chain_hash
          FROM cap_trust_audit
          WHERE audit_chain_id = $1
          ORDER BY sequence_no ASC NULLS LAST, created_at ASC
          LIMIT $2
        `
        : `
          SELECT id, event_type, agent_id, user_id, capability_id, execution_id,
                 approval_id, ip, user_agent, input_summary, risk_level, result,
                 result_hash, metadata, created_at, audit_chain_id, sequence_no,
                 prev_hash, chain_hash
          FROM cap_trust_audit
          ORDER BY created_at DESC
          LIMIT $1
        `,
      chainId ? [chainId, limit] : [limit],
    );
    return Response.json(
      sanitizeAgentResponse({
        ok: true,
        items: result.rows.map((row) => ({
          id: String(row.id),
          event_type: String(row.event_type),
          agent_id: row.agent_id ? String(row.agent_id) : null,
          user_id: row.user_id ? String(row.user_id) : null,
          capability_id: row.capability_id ? String(row.capability_id) : null,
          execution_id: row.execution_id ? String(row.execution_id) : null,
          approval_id: row.approval_id ? String(row.approval_id) : null,
          audit_chain_id: row.audit_chain_id ? String(row.audit_chain_id) : null,
          sequence_no: row.sequence_no != null ? Number(row.sequence_no) : null,
          prev_hash: row.prev_hash ? String(row.prev_hash) : null,
          chain_hash: row.chain_hash ? String(row.chain_hash) : null,
          ip: row.ip ? String(row.ip) : null,
          user_agent: row.user_agent ? String(row.user_agent) : null,
          input_summary: row.input_summary ? String(row.input_summary) : null,
          risk_level: row.risk_level ? String(row.risk_level) : null,
          result: row.result ? String(row.result) : null,
          created_at: new Date(String(row.created_at)).toISOString(),
        })),
      }),
    );
  }

  // Policies
  if (request.method === "GET" && path === "/api/v3/policies") {
    await requireUserSession(request).catch(() => requireAdminAccess(request));
    const { listAllTrustPolicies } = await import("../v3/policy-engine/policy.repository");
    const { checkTrustLayerReadiness } = await import("../v3/trust-layer-readiness");
    const readiness = await checkTrustLayerReadiness();
    if (!readiness.ready) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "schema_not_ready",
            message: "Policy engine is unavailable. Contact the operator.",
            recoverable: false,
          },
        },
        { status: 503 },
      );
    }

    const [legacy, permissions, trustPolicies] = await Promise.all([
      listPolicies(),
      listAllCapabilityPermissions(200),
      listAllTrustPolicies(200),
    ]);
    return Response.json(
      sanitizeAgentResponse({
        ok: true,
        trust_policy_engine: {
          ready: true,
          count: trustPolicies.length,
        },
        trust_policies: trustPolicies.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          capability_pattern: p.capability_pattern,
          provider_pattern: p.provider_pattern,
          effect: p.effect,
          risk_level: p.risk_level,
          priority: p.priority,
          enabled: p.enabled,
          status: p.status,
          destructive_action_block: p.destructive_action_block,
          require_reauth: p.require_reauth,
          rate_limit_per_minute: p.rate_limit_per_minute,
          metadata: p.metadata,
        })),
        policies: legacy.map((p) => ({
          id: p.id,
          capability_id: p.capability_id,
          capability_pattern: p.capability_pattern,
          risk_level: p.risk_level,
          action: p.action,
          priority: p.priority,
          enabled: p.enabled,
          metadata: p.metadata,
        })),
        capability_permissions: permissions.map((p) => ({
          id: p.id,
          agent_id: p.agent_id,
          capability_id: p.capability_id,
          capability_pattern: p.capability_pattern,
          provider_pattern: p.provider_pattern,
          effect: p.effect,
          max_risk_level: p.max_risk_level,
          require_approval: p.require_approval,
          rate_limit_per_minute: p.rate_limit_per_minute,
          priority: p.priority,
          enabled: p.enabled,
          metadata: p.metadata,
        })),
      }),
    );
  }

  if (request.method === "POST" && path === "/api/v3/policies") {
    await requireAdminAccess(request);
    const body = await parseJsonBody(request);

    if (body.kind === "trust_policy" || body.name) {
      const { createTrustPolicy } = await import("../v3/policy-engine/policy.repository");
      const effect = String(body.effect ?? body.action ?? "allow") as
        | "allow"
        | "deny"
        | "require_approval"
        | "require_reauth"
        | "scope_limit"
        | "rate_limit"
        | "destructive_action_block"
        | "time_window"
        | "resource_constraint"
        | "agent_allowlist"
        | "provider_allowlist";
      const policy = await createTrustPolicy({
        name: String(body.name ?? `policy-${Date.now()}`),
        description: typeof body.description === "string" ? body.description : "",
        capability_pattern:
          typeof body.capability_pattern === "string" ? body.capability_pattern : null,
        provider_pattern:
          typeof body.provider_pattern === "string" ? body.provider_pattern : null,
        effect,
        risk_level:
          body.risk_level === "low" ||
          body.risk_level === "high" ||
          body.risk_level === "critical"
            ? body.risk_level
            : "medium",
        priority: typeof body.priority === "number" ? body.priority : 100,
        destructive_action_block: Boolean(body.destructive_action_block),
        require_reauth: Boolean(body.require_reauth),
        rate_limit_per_minute:
          typeof body.rate_limit_per_minute === "number" ? body.rate_limit_per_minute : null,
        metadata: (body.metadata as JsonObject) ?? {},
      });
      return Response.json(sanitizeAgentResponse({ ok: true, policy }), { status: 201 });
    }

    if (body.kind === "capability_permission" || body.effect) {
      const perm = await createCapabilityPermission({
        agent_id: typeof body.agent_id === "string" ? body.agent_id : null,
        capability_id: typeof body.capability_id === "string" ? body.capability_id : null,
        capability_pattern:
          typeof body.capability_pattern === "string" ? body.capability_pattern : null,
        provider_pattern:
          typeof body.provider_pattern === "string" ? body.provider_pattern : null,
        effect:
          body.effect === "deny" || body.effect === "require_approval" || body.effect === "require_reauth"
            ? body.effect
            : "allow",
        max_risk_level: typeof body.max_risk_level === "string" ? body.max_risk_level : null,
        require_approval:
          typeof body.require_approval === "boolean" ? body.require_approval : null,
        rate_limit_per_minute:
          typeof body.rate_limit_per_minute === "number" ? body.rate_limit_per_minute : null,
        priority: typeof body.priority === "number" ? body.priority : 100,
        metadata: (body.metadata as JsonObject) ?? {},
      });
      return Response.json(sanitizeAgentResponse({ ok: true, permission: perm }), { status: 201 });
    }

    const policy = await createCapabilityPermission({
      capability_id: typeof body.capability_id === "string" ? body.capability_id : null,
      capability_pattern:
        typeof body.capability_pattern === "string" ? body.capability_pattern : null,
      effect: body.action === "allow" ? "allow" : body.action === "require_approval" ? "require_approval" : "deny",
      priority: typeof body.priority === "number" ? body.priority : 100,
      metadata: (body.metadata as JsonObject) ?? {},
    });
    return Response.json(sanitizeAgentResponse({ ok: true, policy }), { status: 201 });
  }

  // Secrets — metadata list (no values)
  if (request.method === "GET" && path === "/api/v3/secrets") {
    await requireAdminAccess(request);
    const result = await pool.query(
      `
        SELECT id, secret_ref, secret_type, owner_type, owner_id, status, fingerprint,
               provider_id, user_id, expires_at, rotated_at, created_at, updated_at, metadata
        FROM cap_secret_vault
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [Math.min(Number(url.searchParams.get("limit") ?? "50"), 200)],
    );
    return Response.json(
      sanitizeAgentResponse({
        ok: true,
        items: result.rows.map((row) => ({
          secret_ref: String(row.secret_ref ?? row.id),
          secret_type: String(row.secret_type),
          owner_type: String(row.owner_type),
          owner_id: String(row.owner_id),
          status: String(row.status ?? "active"),
          fingerprint: String(row.fingerprint ?? ""),
          provider_id: row.provider_id ? String(row.provider_id) : null,
          user_id: row.user_id ? String(row.user_id) : null,
          expires_at: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
          rotated_at: row.rotated_at ? new Date(String(row.rotated_at)).toISOString() : null,
          created_at: new Date(String(row.created_at)).toISOString(),
          // Never include encrypted_payload or plaintext
        })),
      }),
    );
  }

  // Secrets — metadata only
  {
    const secretMatch = path.match(/^\/api\/v3\/secrets\/([^/]+)$/);
    if (request.method === "GET" && secretMatch) {
      await requireAdminAccess(request);
      const wantValue = url.searchParams.get("include_value") === "1";
      if (wantValue) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "secret_value_forbidden",
              message: "Secret values cannot be read via API. Agents never receive secrets.",
              recoverable: false,
            },
          },
          { status: 403 },
        );
      }
      const meta = await secretVaultService.getSecretMetadataByRef(
        decodeURIComponent(secretMatch[1]!),
      );
      if (!meta) throw new NotFoundError("Secret not found");
      return Response.json(sanitizeAgentResponse({ ok: true, secret: meta }));
    }
  }

  // Capability by id
  {
    const capMatch = path.match(/^\/api\/v3\/capabilities\/([^/]+)$/);
    if (request.method === "GET" && capMatch) {
      const idOrName = decodeURIComponent(capMatch[1]!);
      const cap =
        (await findCapabilityById(idOrName)) ?? (await findCapabilityByName(idOrName));
      if (!cap || cap.deleted_at) throw new NotFoundError("Capability not found");
      return Response.json(sanitizeAgentResponse({ ok: true, capability: publicCapabilityView(cap) }));
    }
  }

  return Response.json(
    { ok: false, error: { code: "not_found", message: `No route for ${path}` } },
    { status: 404 },
  );
}

async function serveApiV3OpenApi(_request: Request): Promise<Response> {
  const doc = {
    openapi: "3.0.3",
    info: {
      title: "CNothing Execution Trust Layer API",
      version: "3.2.0",
      description:
        "Agent thinks. cnothing executes. Secrets never leave cnothing. Every risky action is approved, executed, and audited. No endpoint returns secret values.",
    },
    paths: {
      "/api/v3/providers": {
        get: { summary: "List OAuth providers (public metadata)" },
        post: { summary: "Register provider (admin; client_secret never via agent)" },
      },
      "/api/v3/oauth/connect": {
        post: { summary: "Start OAuth connect for current user session" },
      },
      "/api/v3/capabilities": {
        get: { summary: "List capabilities with risk_level, execution_type, approval_policy" },
      },
      "/api/v3/capabilities/{id}": {
        get: { summary: "Capability detail" },
      },
      "/api/v3/capabilities/{id}/invoke": {
        post: {
          summary: "Invoke capability (secretless Execution Trust Layer)",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    agent_id: { type: "string" },
                    user_id: { type: "string" },
                    input: { type: "object" },
                    idempotency_key: { type: "string" },
                    dry_run: { type: "boolean" },
                    approval_id: { type: "string" },
                    timeout_ms: { type: "integer", description: "Worker timeout (max 300000)" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "completed (sanitized result) or dry_run" },
            "202": { description: "pending_approval" },
            "403": { description: "denied by policy (status=denied)" },
            "409": { description: "reconnect_required" },
            "400": { description: "failed / timeout" },
          },
        },
      },
      "/api/v3/approvals": {
        get: { summary: "List approvals (safe summary only)" },
      },
      "/api/v3/approvals/{id}": {
        get: { summary: "Approval status (pending|approved|rejected|expired|cancelled)" },
      },
      "/api/v3/approvals/{id}/decide": {
        post: { summary: "User approve/reject (session or short-lived token); may resume execution" },
      },
      "/api/v3/executions": {
        get: { summary: "List executions (lifecycle status)" },
      },
      "/api/v3/executions/{id}": {
        get: { summary: "Execution status + policy_decision + audit_chain_id" },
      },
      "/api/v3/audit": {
        get: { summary: "Trust audit query (no secrets); filter by audit_chain_id" },
      },
      "/api/v3/audit/chains/{id}": {
        get: { summary: "Audit chain view with hash integrity" },
      },
      "/api/v3/policies": {
        get: { summary: "List trust policies, legacy policies, capability permissions" },
        post: { summary: "Create trust policy or capability permission (admin)" },
      },
      "/api/v3/secrets": {
        get: { summary: "Secret Vault metadata list (never values)" },
      },
      "/api/v3/secrets/{ref}": {
        get: { summary: "Secret metadata only (403 if include_value requested)" },
      },
    },
  };
  return Response.json(doc);
}
