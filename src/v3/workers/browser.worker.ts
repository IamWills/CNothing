import type { CapabilityRecord, JsonObject } from "../../v2/v2.entity";
import type { ExecutionWorker, WorkerExecuteInput, WorkerExecuteResult } from "./types";
import { WorkerNotImplementedError } from "./types";

/**
 * BrowserWorker interface for secretless browser automation.
 *
 * Security invariants:
 * - Agent never receives cookies, passwords, or CAPTCHA/MFA secrets
 * - CAPTCHA/MFA must go through human approval or user action
 * - Screenshots, DOM dumps, and logs must be sanitized before return
 */
export interface BrowserSessionHandle {
  session_id: string;
  status: "active" | "waiting_for_user" | "closed";
}

export interface BrowserWorkerOps {
  start_session(input: {
    user_id: string;
    capability: CapabilityRecord;
    start_url?: string;
  }): Promise<BrowserSessionHandle>;

  navigate(session_id: string, url: string): Promise<void>;

  fill(session_id: string, selector: string, value_ref: string): Promise<void>;

  click(session_id: string, selector: string): Promise<void>;

  wait_for_user(session_id: string, reason: string): Promise<{
    status: "waiting_for_user";
    approval_required: true;
    reason: string;
  }>;

  extract_safe_result(session_id: string): Promise<JsonObject>;

  close_session(session_id: string): Promise<void>;
}

export class BrowserWorker implements ExecutionWorker, BrowserWorkerOps {
  readonly name = "BrowserWorker";
  readonly executionTypes = ["browser"] as const;

  canHandle(capability: CapabilityRecord): boolean {
    return capability.execution_type === "browser";
  }

  timeoutMs(): number {
    return 120_000;
  }

  async execute(_input: WorkerExecuteInput): Promise<WorkerExecuteResult> {
    throw new WorkerNotImplementedError(this.name);
  }

  async start_session(): Promise<BrowserSessionHandle> {
    throw new WorkerNotImplementedError(this.name);
  }

  async navigate(): Promise<void> {
    throw new WorkerNotImplementedError(this.name);
  }

  async fill(): Promise<void> {
    throw new WorkerNotImplementedError(this.name);
  }

  async click(): Promise<void> {
    throw new WorkerNotImplementedError(this.name);
  }

  async wait_for_user(
    _session_id: string,
    reason: string,
  ): Promise<{ status: "waiting_for_user"; approval_required: true; reason: string }> {
    return { status: "waiting_for_user", approval_required: true, reason };
  }

  async extract_safe_result(): Promise<JsonObject> {
    throw new WorkerNotImplementedError(this.name);
  }

  async close_session(): Promise<void> {
    throw new WorkerNotImplementedError(this.name);
  }
}

export const browserWorker = new BrowserWorker();
