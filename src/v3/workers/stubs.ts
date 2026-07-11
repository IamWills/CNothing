import type { CapabilityRecord } from "../../v2/v2.entity";
import type { ExecutionWorker, ExecutionContext, ExecutionResult } from "./types";
import { WorkerNotImplementedError } from "./types";

/**
 * ApiKeyWorker — production interface.
 * Decrypts api_key secret_ref inside worker only; never returns key to agent.
 */
export class ApiKeyWorker implements ExecutionWorker {
  readonly name = "ApiKeyWorker";
  readonly executionTypes = ["api_key_api"] as const;

  canHandle(capability: CapabilityRecord): boolean {
    return capability.execution_type === "api_key_api";
  }

  timeoutMs(): number {
    return 30_000;
  }

  async execute(_context: ExecutionContext): Promise<ExecutionResult> {
    throw new WorkerNotImplementedError(this.name);
  }
}

/**
 * SshWorker — production interface.
 * Private keys stay in Secret Vault; agent only sees sanitized command output.
 */
export class SshWorker implements ExecutionWorker {
  readonly name = "SshWorker";
  readonly executionTypes = ["ssh"] as const;

  canHandle(capability: CapabilityRecord): boolean {
    return capability.execution_type === "ssh";
  }

  timeoutMs(): number {
    return 60_000;
  }

  async execute(_context: ExecutionContext): Promise<ExecutionResult> {
    throw new WorkerNotImplementedError(this.name);
  }
}

/**
 * WebhookWorker — production interface for outbound signed webhooks.
 */
export class WebhookWorker implements ExecutionWorker {
  readonly name = "WebhookWorker";
  readonly executionTypes = ["webhook"] as const;

  canHandle(capability: CapabilityRecord): boolean {
    return capability.execution_type === "webhook";
  }

  timeoutMs(): number {
    return 15_000;
  }

  async execute(_context: ExecutionContext): Promise<ExecutionResult> {
    throw new WorkerNotImplementedError(this.name);
  }
}

/**
 * ManualWorker — human-in-the-loop execution (operator completes action offline).
 */
export class ManualWorker implements ExecutionWorker {
  readonly name = "ManualWorker";
  readonly executionTypes = ["manual"] as const;

  canHandle(capability: CapabilityRecord): boolean {
    return capability.execution_type === "manual";
  }

  timeoutMs(): number {
    return 5_000;
  }

  async execute(_context: ExecutionContext): Promise<ExecutionResult> {
    throw new WorkerNotImplementedError(this.name);
  }
}

export const apiKeyWorker = new ApiKeyWorker();
export const sshWorker = new SshWorker();
export const webhookWorker = new WebhookWorker();
export const manualWorker = new ManualWorker();
