import type { CapabilityRecord } from "../../v2/v2.entity";
import type { ExecutionWorker, WorkerExecuteInput, WorkerExecuteResult } from "./types";
import { WorkerNotImplementedError } from "./types";

export class ApiKeyWorker implements ExecutionWorker {
  readonly name = "ApiKeyWorker";
  readonly executionTypes = ["api_key_api"] as const;

  canHandle(capability: CapabilityRecord): boolean {
    return capability.execution_type === "api_key_api";
  }

  timeoutMs(): number {
    return 30_000;
  }

  async execute(_input: WorkerExecuteInput): Promise<WorkerExecuteResult> {
    throw new WorkerNotImplementedError(this.name);
  }
}

export class SshWorker implements ExecutionWorker {
  readonly name = "SshWorker";
  readonly executionTypes = ["ssh"] as const;

  canHandle(capability: CapabilityRecord): boolean {
    return capability.execution_type === "ssh";
  }

  timeoutMs(): number {
    return 60_000;
  }

  async execute(_input: WorkerExecuteInput): Promise<WorkerExecuteResult> {
    throw new WorkerNotImplementedError(this.name);
  }
}

export class WebhookWorker implements ExecutionWorker {
  readonly name = "WebhookWorker";
  readonly executionTypes = ["webhook"] as const;

  canHandle(capability: CapabilityRecord): boolean {
    return capability.execution_type === "webhook";
  }

  timeoutMs(): number {
    return 15_000;
  }

  async execute(_input: WorkerExecuteInput): Promise<WorkerExecuteResult> {
    throw new WorkerNotImplementedError(this.name);
  }
}

export class ManualWorker implements ExecutionWorker {
  readonly name = "ManualWorker";
  readonly executionTypes = ["manual"] as const;

  canHandle(capability: CapabilityRecord): boolean {
    return capability.execution_type === "manual";
  }

  timeoutMs(): number {
    return 5_000;
  }

  async execute(_input: WorkerExecuteInput): Promise<WorkerExecuteResult> {
    throw new WorkerNotImplementedError(this.name);
  }
}

export const apiKeyWorker = new ApiKeyWorker();
export const sshWorker = new SshWorker();
export const webhookWorker = new WebhookWorker();
export const manualWorker = new ManualWorker();
