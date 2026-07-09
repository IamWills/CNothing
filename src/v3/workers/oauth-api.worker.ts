import {
  executePlatformCapability,
  PLATFORM_CONNECTOR_PROVIDER,
} from "../../v2/platform-connector.executor";
import { executeSearchCapability } from "../../v2/search-connector.executor";
import { SEARCH_CONNECTOR_PROVIDER } from "../../v2/search-credential.service";
import {
  executeHttpCapability,
  readCapabilityInvocationType,
} from "../../v2/http-invocation.executor";
import { executeMcpCapability } from "../../v2/mcp-invocation.executor";
import { findConnectorById } from "../../v2/v2.repository";
import type { CapabilityRecord } from "../../v2/v2.entity";
import type { ExecutionWorker, WorkerExecuteInput, WorkerExecuteResult } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

export class OAuthApiWorker implements ExecutionWorker {
  readonly name = "OAuthApiWorker";
  readonly executionTypes = ["oauth_api", "hybrid"] as const;

  canHandle(capability: CapabilityRecord): boolean {
    const type = capability.execution_type ?? "oauth_api";
    return type === "oauth_api" || type === "hybrid" || type === "webhook";
  }

  timeoutMs(): number {
    return DEFAULT_TIMEOUT_MS;
  }

  async execute(input: WorkerExecuteInput): Promise<WorkerExecuteResult> {
    if (input.dry_run) {
      return {
        result: {
          dry_run: true,
          capability: input.capability.name,
          would_execute: true,
        },
      };
    }

    const connector = await findConnectorById(input.capability.connector_id);
    if (!connector) {
      throw new Error(`Connector not found for capability ${input.capability.name}`);
    }

    const invocationType = readCapabilityInvocationType(input.capability);
    let result: unknown;

    if (invocationType === "http") {
      result = await executeHttpCapability({
        capability: input.capability,
        payload: input.input,
        accessToken: input.access_token ?? undefined,
      });
    } else if (invocationType === "mcp") {
      result = await executeMcpCapability({
        capability: input.capability,
        payload: input.input,
        accessToken: input.access_token ?? undefined,
      });
    } else if (connector.provider === PLATFORM_CONNECTOR_PROVIDER) {
      result = await executePlatformCapability({
        capability: input.capability.name,
        user_id: input.user_id,
        agent_id: input.agent.id,
        input: input.input,
        access_token: input.access_token ?? undefined,
      });
    } else if (connector.provider === SEARCH_CONNECTOR_PROVIDER) {
      result = await executeSearchCapability({
        capability: input.capability.name,
        user_id: input.user_id,
        agent_id: input.agent.id,
        input: input.input,
      });
    } else {
      throw new Error(
        `OAuthApiWorker cannot execute connector provider: ${connector.provider}`,
      );
    }

    return { result };
  }
}

export const oauthApiWorker = new OAuthApiWorker();
