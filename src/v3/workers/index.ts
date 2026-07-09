import type { CapabilityRecord } from "../../v2/v2.entity";
import type { ExecutionWorker } from "./types";
import { oauthApiWorker } from "./oauth-api.worker";
import { browserWorker } from "./browser.worker";
import { apiKeyWorker, sshWorker, webhookWorker, manualWorker } from "./stubs";
import { WorkerNotImplementedError } from "./types";

const workers: ExecutionWorker[] = [
  oauthApiWorker,
  browserWorker,
  apiKeyWorker,
  sshWorker,
  webhookWorker,
  manualWorker,
];

export function resolveWorker(capability: CapabilityRecord): ExecutionWorker {
  const match = workers.find((worker) => worker.canHandle(capability));
  if (!match) {
    throw new WorkerNotImplementedError(
      `No worker for execution_type=${capability.execution_type}`,
    );
  }
  return match;
}

export { workers };
export type { ExecutionWorker };
