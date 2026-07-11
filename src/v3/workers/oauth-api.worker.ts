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
import {
  findOAuthConnectionById,
  getConnectionAccessToken,
  touchOAuthConnection,
} from "../../v2/oauth.repository";
import { oauthConnectionService } from "../../v2/oauth-connection.service";
import { resolveGitHubAccessToken } from "../../v2/github-credential.service";
import { ForbiddenError } from "../../utils/errors";
import { normalizeTenantId } from "../tenant-context.service";
import { appendAuditChainEvent } from "../audit/audit-chain";
import type { CapabilityRecord } from "../../v2/v2.entity";
import type { ExecutionWorker, ExecutionContext, ExecutionResult } from "./types";
import { sanitizeWorkerResult } from "../sanitizer/sanitizer";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * OAuthApiWorker — full production implementation.
 *
 * Security boundary: OAuth / API tokens are decrypted ONLY inside this worker.
 * Gateway passes secret_refs / connection_id; never plaintext tokens.
 * Results are always sanitized before leaving the worker.
 */
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

  /**
   * Resolve access token inside the worker boundary.
   * Writes secret_accessed audit when audit_chain_id is present.
   */
  private async resolveAccessToken(context: ExecutionContext): Promise<string | null> {
    // Deprecated plaintext path (should be null from gateway)
    if (context.access_token) {
      return context.access_token;
    }

    if (context.connection_id) {
      let connection = await findOAuthConnectionById(context.connection_id);
      if (!connection || connection.status === "revoked") {
        throw new ForbiddenError("OAuth connection unavailable", {
          error_code: "reconnect_required",
        });
      }
      if (connection.status === "reconnect_required") {
        throw new ForbiddenError("OAuth connection requires reconnection", {
          error_code: "reconnect_required",
        });
      }

      if (
        connection.expires_at &&
        new Date(connection.expires_at).getTime() < Date.now() + 60_000
      ) {
        await oauthConnectionService.refreshConnectionTokens(connection.id);
        connection = await findOAuthConnectionById(connection.id);
        if (!connection || connection.status === "reconnect_required") {
          throw new ForbiddenError("OAuth connection requires reconnection", {
            error_code: "reconnect_required",
          });
        }
      }

      await touchOAuthConnection(connection.id);
      const token = await getConnectionAccessToken(connection);

      if (context.audit_chain_id) {
        await appendAuditChainEvent({
          audit_chain_id: context.audit_chain_id,
          event_type: "secret_accessed",
          execution_id: context.execution_id,
          agent_id: context.agent.id,
          user_id: context.user_id,
          capability_id: context.capability.id,
          result: "worker_only",
          metadata: {
            secret_refs: context.secret_refs,
            note: "Token decrypted inside OAuthApiWorker; never returned to agent",
          },
        });
      }

      return token;
    }

    // Legacy GitHub credential path (pre-OAuth-connection)
    if (context.capability.name.startsWith("github.")) {
      const token = await resolveGitHubAccessToken(context.user_id);
      if (token && context.audit_chain_id) {
        await appendAuditChainEvent({
          audit_chain_id: context.audit_chain_id,
          event_type: "secret_accessed",
          execution_id: context.execution_id,
          agent_id: context.agent.id,
          user_id: context.user_id,
          capability_id: context.capability.id,
          result: "worker_only",
          metadata: {
            secret_refs: context.secret_refs,
            source: "legacy_github_credential",
          },
        });
      }
      return token;
    }

    return null;
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    if (context.dry_run) {
      return {
        result: {
          dry_run: true,
          capability: context.capability.name,
          would_execute: true,
        },
      };
    }

    const connector = await findConnectorById(context.capability.connector_id);
    if (!connector) {
      throw new Error(`Connector not found for capability ${context.capability.name}`);
    }

    const accessToken = await this.resolveAccessToken(context);

    const invocationType = readCapabilityInvocationType(context.capability);
    let result: unknown;

    if (invocationType === "http") {
      result = await executeHttpCapability({
        capability: context.capability,
        payload: context.input,
        accessToken: accessToken ?? undefined,
      });
    } else if (invocationType === "mcp") {
      result = await executeMcpCapability({
        capability: context.capability,
        payload: context.input,
        accessToken: accessToken ?? undefined,
      });
    } else if (connector.provider === PLATFORM_CONNECTOR_PROVIDER) {
      result = await executePlatformCapability({
        capability: context.capability.name,
        user_id: context.user_id,
        agent_id: context.agent.id,
        input: context.input,
        access_token: accessToken ?? undefined,
      });
    } else if (connector.provider === SEARCH_CONNECTOR_PROVIDER) {
      result = await executeSearchCapability({
        capability: context.capability.name,
        user_id: context.user_id,
        agent_id: context.agent.id,
        input: context.input,
      });
    } else {
      throw new Error(
        `OAuthApiWorker cannot execute connector provider: ${connector.provider}`,
      );
    }

    return {
      result: sanitizeWorkerResult(result),
      metadata: {
        worker: this.name,
        secret_refs_used: context.secret_refs.length,
        tenant: normalizeTenantId(context.agent.tenant_id),
      },
    };
  }
}

export const oauthApiWorker = new OAuthApiWorker();
