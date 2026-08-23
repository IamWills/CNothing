import { createHmac, randomBytes } from "node:crypto";

import config from "../config";
import { encryptWithAes256Gcm, decryptWithAes256Gcm } from "../crypto/master-key";
import { withTransaction } from "../db";
import {
  AppError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../utils/errors";
import { createAgent } from "./platform.repository";
import {
  claimEnrollmentToken,
  countRecentEnrollmentsByIp,
  findAgentEnrollmentById,
  insertAgentEnrollment,
  lockAgentEnrollment,
  markEnrollmentApproved,
  markEnrollmentDenied,
  markEnrollmentExpired,
  type AgentEnrollmentRecord,
} from "./agent-enrollment.repository";

const ENROLLMENT_TTL_SECONDS = 10 * 60;
const POLL_INTERVAL_SECONDS = 5;
const RATE_WINDOW_SECONDS = 60 * 60;
const MAX_ENROLLMENTS_PER_IP = 10;
const MAX_PENDING_PER_IP = 5;

export class TooManyRequestsError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 429, details);
  }
}

function hashEnrollmentSecret(secret: string): string {
  return createHmac("sha256", config.masterKey).update(`agent-enrollment:${secret}`).digest("hex");
}

function generateEnrollmentSecret(): string {
  return `enrs_${randomBytes(32).toString("base64url")}`;
}

function generateUserCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function packEncrypted(plaintext: string): Buffer {
  const wrapped = encryptWithAes256Gcm({
    plaintext: Buffer.from(plaintext, "utf8"),
    key: config.masterKey,
  });
  return Buffer.concat([wrapped.iv, wrapped.tag, wrapped.ciphertext]);
}

function unpackEncrypted(packed: Buffer): string {
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  return decryptWithAes256Gcm({
    ciphertext,
    key: config.masterKey,
    iv,
    tag,
  }).toString("utf8");
}

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function optionalHttpsUri(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, { error_code: "invalid_field", field });
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ValidationError(`${field} must be an absolute URI`, { error_code: "invalid_url", field });
  }
  if (parsed.protocol !== "https:") {
    throw new ValidationError(`${field} must use https`, { error_code: "https_required", field });
  }
  if (parsed.username || parsed.password) {
    throw new ValidationError(`${field} must not contain credentials`, {
      error_code: "invalid_url",
      field,
    });
  }
  return parsed.toString();
}

function approvalUrlFor(enrollmentId: string, apiBaseUrl: string): string {
  const approvalBase = config.consoleUrl?.replace(/\/+$/, "") ?? apiBaseUrl.replace(/\/+$/, "");
  return `${approvalBase}/approve-agent/${enrollmentId}`;
}

function effectiveStatus(record: AgentEnrollmentRecord): AgentEnrollmentRecord["status"] {
  if (record.status === "pending" && Date.parse(record.expires_at) <= Date.now()) {
    return "expired";
  }
  return record.status;
}

function publicView(record: AgentEnrollmentRecord, apiBaseUrl: string) {
  const status = effectiveStatus(record);
  return {
    ok: true as const,
    enrollment_id: record.id,
    status,
    client_name: record.client_name,
    client_uri: record.client_uri,
    software_id: record.software_id,
    user_code: record.user_code,
    approval_url: approvalUrlFor(record.id, apiBaseUrl),
    expires_at: record.expires_at,
    agent_id: record.agent_id,
    claimed: Boolean(record.claimed_at),
  };
}

export function readEnrollmentSecret(request: Request): string | null {
  const header = request.headers.get("Authorization")?.trim();
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim() ?? "";
  return token.startsWith("enrs_") ? token : null;
}

export class AgentEnrollmentService {
  async create(input: {
    request: Request;
    apiBaseUrl: string;
    client_name?: string;
    client_uri?: unknown;
    software_id?: unknown;
  }) {
    const clientName = (input.client_name ?? "cnothing-plugin").trim();
    if (!clientName || clientName.length > 80) {
      throw new ValidationError("client_name must be 1-80 characters", {
        error_code: "invalid_field",
        field: "client_name",
      });
    }
    const clientUri = optionalHttpsUri(input.client_uri, "client_uri");
    const softwareId =
      typeof input.software_id === "string" && input.software_id.trim()
        ? input.software_id.trim().slice(0, 128)
        : undefined;

    const issuedIp = clientIp(input.request);
    const usage = await countRecentEnrollmentsByIp({
      issued_ip: issuedIp,
      window_seconds: RATE_WINDOW_SECONDS,
    });
    if (usage.total >= MAX_ENROLLMENTS_PER_IP || usage.pending >= MAX_PENDING_PER_IP) {
      throw new TooManyRequestsError("Too many agent enrollment attempts from this network", {
        error_code: "enrollment_rate_limited",
        retry_after_seconds: 3600,
      });
    }

    const enrollmentSecret = generateEnrollmentSecret();
    const userCode = generateUserCode();
    const record = await insertAgentEnrollment({
      client_name: clientName,
      client_uri: clientUri,
      software_id: softwareId,
      user_code: userCode,
      enrollment_secret_hash: hashEnrollmentSecret(enrollmentSecret),
      issued_ip: issuedIp,
      ttl_seconds: ENROLLMENT_TTL_SECONDS,
    });
    const approvalUrl = approvalUrlFor(record.id, input.apiBaseUrl);

    return {
      ok: true as const,
      status: "pending" as const,
      enrollment_id: record.id,
      enrollment_secret: enrollmentSecret,
      user_code: record.user_code,
      approval_url: approvalUrl,
      poll_url: `${input.apiBaseUrl.replace(/\/+$/, "")}/v4/agent-enrollments/${record.id}`,
      expires_at: record.expires_at,
      interval: POLL_INTERVAL_SECONDS,
      retry_after_seconds: POLL_INTERVAL_SECONDS,
      host_only: true as const,
      next_action: "wait_for_user" as const,
      user_action: {
        message:
          "Open this CNothing URL and confirm the pairing code matches. Do not paste any token into chat.",
        approval_url: approvalUrl,
        user_code: record.user_code,
      },
      warning:
        "enrollment_secret and the issued agent token must stay in the host secret store. Never return them from an MCP tool or show them to the model.",
    };
  }

  async publicStatus(id: string, apiBaseUrl: string) {
    const record = await findAgentEnrollmentById(id);
    if (!record) throw new NotFoundError("Enrollment not found");
    return publicView(record, apiBaseUrl);
  }

  async poll(input: { id: string; secret: string; apiBaseUrl: string }) {
    const record = await findAgentEnrollmentById(input.id);
    if (!record || record.enrollment_secret_hash !== hashEnrollmentSecret(input.secret)) {
      throw new UnauthorizedError("Invalid enrollment secret", {
        error_code: "invalid_enrollment_secret",
      });
    }

    const status = effectiveStatus(record);
    if (status === "pending") {
      return {
        ok: true as const,
        status: "pending" as const,
        enrollment_id: record.id,
        retry_after_seconds: POLL_INTERVAL_SECONDS,
        next_action: "wait_for_user" as const,
        user_action: {
          message:
            "Waiting for the user to approve this agent runtime. Relay approval_url unchanged. Do not ask for a token.",
          approval_url: approvalUrlFor(record.id, input.apiBaseUrl),
          user_code: record.user_code,
        },
      };
    }
    if (status === "denied") {
      return {
        ok: false as const,
        status: "denied" as const,
        enrollment_id: record.id,
        next_action: "none" as const,
      };
    }
    if (status === "expired") {
      if (record.status === "pending") {
        await withTransaction(async (client) => markEnrollmentExpired(client, record.id));
      }
      return {
        ok: false as const,
        status: "expired" as const,
        enrollment_id: record.id,
        next_action: "restart_enrollment" as const,
      };
    }

    if (record.claimed_at) {
      return {
        ok: true as const,
        status: "approved" as const,
        enrollment_id: record.id,
        agent_id: record.agent_id,
        token_delivered: true as const,
        next_action: "use_stored_agent_token" as const,
      };
    }

    return withTransaction(async (client) => {
      const locked = await lockAgentEnrollment(client, record.id);
      if (!locked) throw new NotFoundError("Enrollment not found");
      if (locked.claimed_at) {
        return {
          ok: true as const,
          status: "approved" as const,
          enrollment_id: locked.id,
          agent_id: locked.agent_id,
          token_delivered: true as const,
          next_action: "use_stored_agent_token" as const,
        };
      }
      if (!locked.access_token_encrypted) {
        throw new ConflictError("Enrollment is approved but the token is no longer available", {
          error_code: "token_already_claimed",
        });
      }
      const accessToken = unpackEncrypted(locked.access_token_encrypted);
      await claimEnrollmentToken(client, locked.id);
      return {
        ok: true as const,
        status: "approved" as const,
        enrollment_id: locked.id,
        agent_id: locked.agent_id,
        access_token: accessToken,
        token_delivered: false as const,
        host_only: true as const,
        next_action: "store_token_and_call_list_grants" as const,
        warning:
          "Store access_token in the host secret store now. Never return it from an MCP tool or show it to the model.",
      };
    });
  }

  async approve(input: { id: string; userId: string; apiBaseUrl: string }) {
    return withTransaction(async (client) => {
      const locked = await lockAgentEnrollment(client, input.id);
      if (!locked) throw new NotFoundError("Enrollment not found");
      const status = effectiveStatus(locked);
      if (status === "expired") {
        await markEnrollmentExpired(client, locked.id);
        throw new ConflictError("This enrollment has expired", { error_code: "enrollment_expired" });
      }
      if (status === "denied") {
        throw new ConflictError("This enrollment was denied", { error_code: "enrollment_denied" });
      }
      if (status === "approved") {
        return {
          ok: true as const,
          status: "approved" as const,
          enrollment_id: locked.id,
          agent_id: locked.agent_id,
          client_name: locked.client_name,
          already_approved: true as const,
        };
      }

      const created = await createAgent({
        name: locked.client_name,
        owner_user_id: input.userId,
        metadata: { enrollment_id: locked.id, software_id: locked.software_id },
        client,
      });
      const updated = await markEnrollmentApproved(client, {
        id: locked.id,
        owner_user_id: input.userId,
        agent_id: created.agent.id,
        access_token_encrypted: packEncrypted(created.access_token),
      });
      return {
        ok: true as const,
        status: "approved" as const,
        enrollment_id: updated.id,
        agent_id: created.agent.id,
        client_name: updated.client_name,
        already_approved: false as const,
        message:
          "This runtime is now your CNothing agent. The credential was issued to the plugin and will not be shown here.",
      };
    });
  }

  async deny(input: { id: string; userId: string }) {
    return withTransaction(async (client) => {
      const locked = await lockAgentEnrollment(client, input.id);
      if (!locked) throw new NotFoundError("Enrollment not found");
      const status = effectiveStatus(locked);
      if (status === "approved") {
        throw new ConflictError("This enrollment was already approved", {
          error_code: "enrollment_already_approved",
        });
      }
      if (status === "expired") {
        await markEnrollmentExpired(client, locked.id);
        throw new ConflictError("This enrollment has expired", { error_code: "enrollment_expired" });
      }
      if (status === "denied") {
        return { ok: true as const, status: "denied" as const, enrollment_id: locked.id };
      }
      const updated = await markEnrollmentDenied(client, locked.id, input.userId);
      return { ok: true as const, status: "denied" as const, enrollment_id: updated.id };
    });
  }
}

export const agentEnrollmentService = new AgentEnrollmentService();
