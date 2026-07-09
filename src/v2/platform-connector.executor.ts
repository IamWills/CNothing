import config from "../config";
import type { JsonObject } from "./v2.entity";
import {
  executeGoogleCapability,
  executeMicrosoftCapability,
  executeNotionCapability,
  executeSlackCapability,
  isGoogleCapability,
  isMicrosoftCapability,
  isNotionCapability,
  isSlackCapability,
} from "./builtin-provider.executor";
import {
  executeHttpCapability,
  readCapabilityInvocationType,
} from "./http-invocation.executor";
import {
  githubCredentialRequiredMessage,
  isGitHubCapabilityEnabled,
  resolveGitHubAccessToken,
} from "./github-credential.service";

async function githubRequest(
  path: string,
  userId: string,
  init?: RequestInit,
  accessTokenOverride?: string,
) {
  const token = accessTokenOverride ?? (await resolveGitHubAccessToken(userId));
  if (!token) {
    throw new Error(githubCredentialRequiredMessage(userId));
  }

  const response = await fetch(`${config.githubApiBaseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message?: string }).message ?? "GitHub API error")
        : `GitHub API returned ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function postWebhook(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }
  return { status: response.status, body };
}

export async function executePlatformCapability(input: {
  capability: string;
  input: JsonObject;
  user_id: string;
  agent_id: string;
  access_token?: string;
}): Promise<unknown> {
  const tokenOverride = input.access_token;
  switch (input.capability) {
    case "platform.echo":
      return {
        echo: input.input,
        capability: input.capability,
        user_id: input.user_id,
        agent_id: input.agent_id,
        timestamp: new Date().toISOString(),
      };

    case "platform.ping":
      return {
        ok: true,
        service: config.serviceName,
        version: "2.0.0",
        timestamp: new Date().toISOString(),
      };

    case "github.list_repositories":
    case "github.list_repos": {
      const perPage = Number(input.input.per_page ?? 30);
      const type = String(input.input.type ?? "all");
      const data = await githubRequest(
        `/user/repos?per_page=${encodeURIComponent(String(perPage))}&type=${encodeURIComponent(type)}`,
        input.user_id,
        undefined,
        tokenOverride,
      );
      return { repositories: data };
    }

    case "github.get_user": {
      const data = await githubRequest("/user", input.user_id, undefined, tokenOverride);
      return { user: data };
    }

    case "github.create_repo": {
      const name = String(input.input.name ?? "").trim();
      if (!name) {
        throw new Error("input.name is required");
      }
      const org = typeof input.input.org === "string" ? input.input.org.trim() : "";
      const body = {
        name,
        description:
          typeof input.input.description === "string" ? input.input.description : undefined,
        private: Boolean(input.input.private ?? false),
        auto_init: Boolean(input.input.auto_init ?? false),
      };
      const path = org ? `/orgs/${encodeURIComponent(org)}/repos` : "/user/repos";
      const data = await githubRequest(
        path,
        input.user_id,
        { method: "POST", body: JSON.stringify(body) },
        tokenOverride,
      );
      return {
        repository: data,
        full_name: (data as { full_name?: string }).full_name,
        html_url: (data as { html_url?: string }).html_url,
        private: (data as { private?: boolean }).private,
      };
    }

    case "github.oauth.connect": {
      const base = config.consoleUrl?.replace(/\/+$/, "") ?? config.publicBaseUrl;
      return {
        connect_url: `${base}/connect?provider=github`,
        provider: "github",
        message: "User must complete OAuth connect in browser. Agent never receives tokens.",
      };
    }

    case "github.get_repository": {
      const repo = String(input.input.repo ?? "");
      if (!repo.includes("/")) {
        throw new Error("input.repo must be in owner/name format");
      }
      const data = await githubRequest(`/repos/${repo}`, input.user_id, undefined, tokenOverride);
      return { repository: data };
    }

    case "github.create_issue": {
      const owner = String(input.input.owner ?? "");
      const repoName = String(input.input.repo ?? "");
      const repo =
        owner && repoName && !repoName.includes("/")
          ? `${owner}/${repoName}`
          : String(input.input.repo ?? "");
      const title = String(input.input.title ?? "");
      const body = typeof input.input.body === "string" ? input.input.body : undefined;
      if (!repo.includes("/")) {
        throw new Error("input.owner and input.repo (or input.repo as owner/name) are required");
      }
      if (!title.trim()) {
        throw new Error("input.title is required");
      }
      const data = await githubRequest(
        `/repos/${repo}/issues`,
        input.user_id,
        {
          method: "POST",
          body: JSON.stringify({
            title,
            body,
            labels: Array.isArray(input.input.labels) ? input.input.labels : undefined,
          }),
        },
        tokenOverride,
      );
      return {
        issue: data,
        issue_number: (data as { number?: number }).number,
        url: (data as { html_url?: string }).html_url,
      };
    }

    case "github.delete_repo": {
      const owner = String(input.input.owner ?? "");
      const repoName = String(input.input.repo ?? "");
      const repo =
        owner && repoName && !repoName.includes("/")
          ? `${owner}/${repoName}`
          : String(input.input.repo ?? "");
      if (!repo.includes("/")) {
        throw new Error("input.owner and input.repo are required");
      }
      await githubRequest(
        `/repos/${repo}`,
        input.user_id,
        { method: "DELETE" },
        tokenOverride,
      );
      return { deleted: true, repo };
    }

    case "webhook.notify": {
      const url =
        typeof input.input.url === "string" && input.input.url.trim()
          ? input.input.url.trim()
          : config.webhookDefaultUrl;
      if (!url) {
        throw new Error("input.url or KEYSERVICE_WEBHOOK_DEFAULT_URL is required");
      }
      const message = String(input.input.message ?? "");
      if (!message.trim()) {
        throw new Error("input.message is required");
      }
      return postWebhook(url, {
        title: String(input.input.title ?? "CNothing notification"),
        message,
        severity: String(input.input.severity ?? "info"),
        source: "cnothing-platform-connector",
        user_id: input.user_id,
        agent_id: input.agent_id,
        capability: input.capability,
        timestamp: new Date().toISOString(),
      });
    }

    default: {
      if (isGoogleCapability(input.capability)) {
        return executeGoogleCapability({
          capability: input.capability,
          payload: input.input,
          accessToken: tokenOverride,
        });
      }
      if (isSlackCapability(input.capability)) {
        return executeSlackCapability({
          capability: input.capability,
          payload: input.input,
          accessToken: tokenOverride,
        });
      }
      if (isNotionCapability(input.capability)) {
        return executeNotionCapability({
          capability: input.capability,
          payload: input.input,
          accessToken: tokenOverride,
        });
      }
      if (isMicrosoftCapability(input.capability)) {
        return executeMicrosoftCapability({
          capability: input.capability,
          payload: input.input,
          accessToken: tokenOverride,
        });
      }
      throw new Error(`Unsupported platform capability: ${input.capability}`);
    }
  }
}

export function listPlatformCapabilityDefinitions(): Array<{
  name: string;
  description: string;
  capability_type: "ACTION" | "QUERY";
  risk_level: "PUBLIC" | "LOW" | "MEDIUM" | "HIGH";
  scopes: string[];
  input_schema: JsonObject;
}> {
  type Definition = {
    name: string;
    description: string;
    capability_type: "ACTION" | "QUERY";
    risk_level: "PUBLIC" | "LOW" | "MEDIUM" | "HIGH";
    scopes: string[];
    input_schema: JsonObject;
  };

  const definitions: Definition[] = [
    {
      name: "platform.echo",
      description: "Echo input — verify invoke chain end-to-end",
      capability_type: "QUERY" as const,
      risk_level: "LOW" as const,
      scopes: ["platform.echo"],
      input_schema: { type: "object", additionalProperties: true },
    },
    {
      name: "platform.ping",
      description: "Platform health ping",
      capability_type: "QUERY" as const,
      risk_level: "PUBLIC" as const,
      scopes: ["platform.read"],
      input_schema: { type: "object", properties: {} },
    },
  ];

  if (isGitHubCapabilityEnabled()) {
    definitions.push(
      {
        name: "github.list_repositories",
        description: "List GitHub repositories for the linked user account",
        capability_type: "QUERY" as const,
        risk_level: "LOW" as const,
        scopes: ["repo.read"],
        input_schema: {
          type: "object",
          properties: { per_page: { type: "number" }, type: { type: "string" } },
        },
      },
      {
        name: "github.get_repository",
        description: "Get metadata for a GitHub repository",
        capability_type: "QUERY" as const,
        risk_level: "LOW" as const,
        scopes: ["repo.read"],
        input_schema: {
          type: "object",
          required: ["repo"],
          properties: { repo: { type: "string", description: "owner/name" } },
        },
      },
      {
        name: "github.create_issue",
        description: "Create a GitHub issue",
        capability_type: "ACTION" as const,
        risk_level: "MEDIUM" as const,
        scopes: ["repo.issue.write"],
        input_schema: {
          type: "object",
          required: ["repo", "title"],
          properties: {
            repo: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            labels: { type: "array", items: { type: "string" } },
          },
        },
      },
    );
  }

  if (config.webhookDefaultUrl) {
    definitions.push({
      name: "webhook.notify",
      description: "Send a structured notification webhook",
      capability_type: "ACTION" as const,
      risk_level: "LOW" as const,
      scopes: ["webhook.send"],
      input_schema: {
        type: "object",
        required: ["message"],
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          message: { type: "string" },
          severity: { type: "string" },
        },
      },
    });
  }

  return definitions;
}

export const PLATFORM_CONNECTOR_PROVIDER = "platform";
