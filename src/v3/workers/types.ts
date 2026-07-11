import type { ExecutionType } from "../../v2/v2.entity";
import type { CapabilityRecord, JsonObject } from "../../v2/v2.entity";
import type { AgentRecord } from "../../v2/v2.entity";

/**
 * Production ExecutionContext passed to every Worker.
 * Secrets are resolved as refs; plaintext tokens only appear inside worker boundary.
 */
export type ExecutionContext = {
  execution_id: string;
  capability: CapabilityRecord;
  agent: AgentRecord;
  user_id: string;
  /** Raw capability input (may contain non-secret business fields). */
  input: JsonObject;
  /** Sanitized input snapshot safe for audit / approval. */
  safe_input: JsonObject;
  /** Opaque secret references — never plaintext. */
  secret_refs: string[];
  /** @deprecated Prefer secret_refs; plaintext only for OAuthApiWorker internal use. */
  access_token: string | null;
  connection_id: string | null;
  policy_decision?: {
    decision: string;
    reason: string;
    matched_policy_id: string | null;
    risk_level: string;
  };
  approval_id?: string | null;
  dry_run: boolean;
  timeout_ms?: number;
  audit_chain_id?: string;
};

/** @deprecated Use ExecutionContext */
export type WorkerExecuteInput = ExecutionContext;

export type ExecutionResult = {
  result: unknown;
  metadata?: JsonObject;
};

/** @deprecated Use ExecutionResult */
export type WorkerExecuteResult = ExecutionResult;

export interface ExecutionWorker {
  readonly name: string;
  readonly executionTypes: readonly ExecutionType[] | ExecutionType[];
  canHandle(capability: CapabilityRecord): boolean;
  execute(context: ExecutionContext): Promise<ExecutionResult>;
  timeoutMs(): number;
}

export class WorkerNotImplementedError extends Error {
  readonly code = "not_implemented";
  constructor(workerName: string) {
    super(`${workerName} is not implemented yet`);
    this.name = "WorkerNotImplementedError";
  }
}
