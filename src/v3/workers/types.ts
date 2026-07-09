import type { ExecutionType } from "../../v2/v2.entity";
import type { CapabilityRecord, JsonObject } from "../../v2/v2.entity";
import type { AgentRecord } from "../../v2/v2.entity";

export type WorkerExecuteInput = {
  capability: CapabilityRecord;
  agent: AgentRecord;
  user_id: string;
  input: JsonObject;
  access_token: string | null;
  connection_id: string | null;
  dry_run: boolean;
  timeout_ms?: number;
};

export type WorkerExecuteResult = {
  result: unknown;
  metadata?: JsonObject;
};

export interface ExecutionWorker {
  readonly name: string;
  readonly executionTypes: ExecutionType[];
  canHandle(capability: CapabilityRecord): boolean;
  execute(input: WorkerExecuteInput): Promise<WorkerExecuteResult>;
  timeoutMs(): number;
}

export class WorkerNotImplementedError extends Error {
  readonly code = "not_implemented";
  constructor(workerName: string) {
    super(`${workerName} is not implemented yet`);
    this.name = "WorkerNotImplementedError";
  }
}
