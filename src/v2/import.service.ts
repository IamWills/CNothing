import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { ValidationError } from "../utils/errors";
import { ensureGatewayConnector } from "./gateway-connector.service";
import { generateCandidatesFromOpenApi } from "./import-openapi.util";
import { findOAuthProviderBySlug } from "./oauth.repository";
import { emitPlatformWebhook } from "./platform-webhook.service";
import type { JsonObject } from "./v2.entity";
import type { ImportJobRecord, ImportJobStatus, ImportJobType } from "./v2.5.entity";

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapImportJobRow(row: Record<string, unknown>): ImportJobRecord {
  return {
    id: String(row.id),
    import_type: String(row.import_type) as ImportJobType,
    status: String(row.status) as ImportJobStatus,
    source_url: row.source_url ? String(row.source_url) : null,
    source_filename: row.source_filename ? String(row.source_filename) : null,
    provider_id: row.provider_id ? String(row.provider_id) : null,
    candidate_count: Number(row.candidate_count ?? 0),
    candidates: Array.isArray(row.candidates) ? (row.candidates as JsonObject[]) : [],
    error_message: row.error_message ? String(row.error_message) : null,
    metadata: (row.metadata as JsonObject) ?? {},
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function inferRiskFromOperation(input: {
  method: string;
  operationId: string;
  summary?: string;
}): { risk_level: string; capability_type: string } {
  const haystack = `${input.method} ${input.operationId} ${input.summary ?? ""}`.toLowerCase();
  if (haystack.includes("delete") || haystack.includes("payment") || haystack.includes("transfer") || haystack.includes("admin")) {
    return { risk_level: "HIGH", capability_type: "ACTION" };
  }
  if (
    haystack.includes("read") &&
    (haystack.includes("email") || haystack.includes("file") || haystack.includes("private") || haystack.includes("message"))
  ) {
    return { risk_level: "CONFIDENTIAL", capability_type: "CONFIDENTIAL_QUERY" };
  }
  if (input.method === "get" || input.method === "head") {
    return { risk_level: "LOW", capability_type: "QUERY" };
  }
  return { risk_level: "MEDIUM", capability_type: "ACTION" };
}

export async function createImportJob(input: {
  import_type: ImportJobType;
  source_url?: string;
  source_filename?: string;
  provider_id?: string;
}): Promise<ImportJobRecord> {
  const id = randomUUID();
  await pool.query(
    `
      INSERT INTO cap_import_jobs (id, import_type, status, source_url, source_filename, provider_id)
      VALUES ($1, $2, 'pending', $3, $4, $5)
    `,
    [id, input.import_type, input.source_url ?? null, input.source_filename ?? null, input.provider_id ?? null],
  );
  return (await findImportJob(id))!;
}

export async function findImportJob(id: string): Promise<ImportJobRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_import_jobs WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? mapImportJobRow(row) : null;
}

export async function updateImportJob(input: {
  id: string;
  status: ImportJobStatus;
  candidates?: JsonObject[];
  error_message?: string;
}): Promise<void> {
  await pool.query(
    `
      UPDATE cap_import_jobs
      SET status = $2,
          candidates = COALESCE($3::jsonb, candidates),
          candidate_count = COALESCE(jsonb_array_length($3::jsonb), candidate_count),
          error_message = $4,
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      input.id,
      input.status,
      input.candidates ? JSON.stringify(input.candidates) : null,
      input.error_message ?? null,
    ],
  );
}

export async function parseOpenApiDocument(content: string): Promise<JsonObject> {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as JsonObject;
  }
  if (trimmed.startsWith("---") || trimmed.includes("\nopenapi:") || trimmed.startsWith("openapi:")) {
    const { parseMinimalYaml } = await import("./openapi-yaml.util");
    return parseMinimalYaml(trimmed) as JsonObject;
  }
  throw new Error("OpenAPI document must be JSON or YAML");
}

export { generateCandidatesFromOpenApi } from "./import-openapi.util";

export async function importOpenApi(input: {
  content: string;
  sourceUrl?: string;
  sourceFilename?: string;
  providerId?: string;
  providerSlug?: string;
}): Promise<ImportJobRecord> {
  const job = await createImportJob({
    import_type: "openapi",
    source_url: input.sourceUrl,
    source_filename: input.sourceFilename,
    provider_id: input.providerId,
  });

  try {
    const doc = await parseOpenApiDocument(input.content);
    const providerSlug =
      input.providerSlug ??
      String((doc.info as JsonObject | undefined)?.title ?? "import")
        .toLowerCase()
        .replace(/[^\w]+/g, "_")
        .slice(0, 32);

    let providerSupportedScopes: string[] = [];
    if (input.providerId) {
      const { findOAuthProviderById } = await import("./oauth.repository");
      const provider = await findOAuthProviderById(input.providerId);
      providerSupportedScopes = provider?.supported_scopes ?? [];
    } else if (input.providerSlug) {
      const provider = await findOAuthProviderBySlug(input.providerSlug);
      providerSupportedScopes = provider?.supported_scopes ?? [];
    }

    const candidates = generateCandidatesFromOpenApi(doc, providerSlug, {
      sourceUrl: input.sourceUrl,
      providerSupportedScopes,
    });
    await updateImportJob({
      id: job.id,
      status: "completed",
      candidates,
    });
  } catch (error) {
    await updateImportJob({
      id: job.id,
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
    });
  }

  return (await findImportJob(job.id))!;
}

export function generateCandidatesFromMcpTools(
  tools: JsonObject[],
  providerSlug: string,
  serverUrl?: string,
): JsonObject[] {
  return tools.map((tool) => {
    const name = `${providerSlug}.${String(tool.name ?? "tool").replace(/[^\w.]+/g, "_")}`;
    const description = String(tool.description ?? "");
    const inferred = inferRiskFromOperation({
      method: "post",
      operationId: String(tool.name ?? "tool"),
      summary: description,
    });
    return {
      name,
      display_name: String(tool.name ?? name),
      description,
      capability_type: inferred.capability_type,
      risk_level: inferred.risk_level,
      required_scopes: [],
      source: "mcp_import",
      invocation_type: "mcp",
      invocation_config: {
        tool_name: tool.name,
        ...(serverUrl ? { server_url: serverUrl } : {}),
      },
      input_schema: tool.inputSchema ?? tool.input_schema ?? { type: "object" },
      policy_config: {},
      enabled: false,
    };
  });
}

export async function importMcpManifest(input: {
  manifest: JsonObject;
  providerId?: string;
  providerSlug?: string;
}): Promise<ImportJobRecord> {
  const job = await createImportJob({
    import_type: "mcp",
    provider_id: input.providerId,
  });

  try {
    const tools = (input.manifest.tools as JsonObject[]) ?? [];
    const providerSlug = input.providerSlug ?? "mcp";
    const serverUrl =
      typeof input.manifest.server_url === "string"
        ? input.manifest.server_url
        : typeof input.manifest.mcp_server_url === "string"
          ? input.manifest.mcp_server_url
          : undefined;
    const candidates = generateCandidatesFromMcpTools(tools, providerSlug, serverUrl);
    await updateImportJob({
      id: job.id,
      status: "completed",
      candidates,
    });
  } catch (error) {
    await updateImportJob({
      id: job.id,
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
    });
  }

  return (await findImportJob(job.id))!;
}

export async function resolveImportActivationContext(input: {
  job: ImportJobRecord;
  connectorId?: string;
  providerId?: string;
  providerSlug?: string;
}): Promise<{ connectorId: string; providerId: string | null; connectionRequired: boolean }> {
  const connectorId = input.connectorId ?? (await ensureGatewayConnector()).id;
  let providerId = input.providerId ?? input.job.provider_id ?? null;
  if (!providerId && input.providerSlug) {
    const provider = await findOAuthProviderBySlug(input.providerSlug);
    providerId = provider?.id ?? null;
  }
  return {
    connectorId,
    providerId,
    connectionRequired: Boolean(providerId),
  };
}

export async function activateOpenApiCandidates(input: {
  jobId: string;
  candidateNames: string[];
  connectorId?: string;
  providerId?: string;
  providerSlug?: string;
}): Promise<{ activated: number }> {
  const job = await findImportJob(input.jobId);
  if (!job || job.import_type !== "openapi") {
    throw new Error("Import job not found");
  }

  const activation = await resolveImportActivationContext({
    job,
    connectorId: input.connectorId,
    providerId: input.providerId,
    providerSlug: input.providerSlug,
  });

  let activated = 0;
  for (const candidate of job.candidates) {
    const name = String(candidate.name ?? "");
    if (!input.candidateNames.includes(name)) {
      continue;
    }

    await pool.query(
      `
        INSERT INTO cap_capabilities (
          id, connector_id, name, description, capability_type, input_schema, output_schema,
          scopes, risk_level, status, metadata, provider_id, display_name, source,
          invocation_type, invocation_config, policy_config, connection_required
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, '{}'::jsonb, $7::jsonb, $8, 'active', '{}'::jsonb,
          $9, $10, 'openapi_import', 'http', $11::jsonb, $12::jsonb, $13
        )
        ON CONFLICT (name) DO UPDATE SET
          description = EXCLUDED.description,
          capability_type = EXCLUDED.capability_type,
          risk_level = EXCLUDED.risk_level,
          invocation_config = EXCLUDED.invocation_config,
          policy_config = EXCLUDED.policy_config,
          provider_id = EXCLUDED.provider_id,
          connection_required = EXCLUDED.connection_required,
          updated_at = NOW()
      `,
      [
        randomUUID(),
        activation.connectorId,
        name,
        String(candidate.description ?? ""),
        String(candidate.capability_type ?? "ACTION"),
        JSON.stringify(candidate.input_schema ?? { type: "object" }),
        JSON.stringify(candidate.required_scopes ?? []),
        String(candidate.risk_level ?? "MEDIUM"),
        activation.providerId,
        String(candidate.display_name ?? name),
        JSON.stringify(candidate.invocation_config ?? {}),
        JSON.stringify(candidate.policy_config ?? {}),
        activation.connectionRequired,
      ],
    );
    activated += 1;
  }

  if (activated > 0) {
    void emitPlatformWebhook({
      event: "import.capabilities.activated",
      payload: {
        job_id: input.jobId,
        import_type: "openapi",
        activated,
        candidate_names: input.candidateNames,
        provider_id: activation.providerId,
      },
    });
  }

  return { activated };
}

export async function activateMcpCandidates(input: {
  jobId: string;
  candidateNames: string[];
  connectorId?: string;
  providerId?: string;
  providerSlug?: string;
}): Promise<{ activated: number }> {
  const job = await findImportJob(input.jobId);
  if (!job || job.import_type !== "mcp") {
    throw new Error("MCP import job not found");
  }

  const activation = await resolveImportActivationContext({
    job,
    connectorId: input.connectorId,
    providerId: input.providerId,
    providerSlug: input.providerSlug,
  });

  let activated = 0;
  for (const candidate of job.candidates) {
    const name = String(candidate.name ?? "");
    if (!input.candidateNames.includes(name)) {
      continue;
    }

    const invocationConfig = (candidate.invocation_config as JsonObject | undefined) ?? {};
    if (!invocationConfig.server_url) {
      throw new ValidationError(`MCP capability ${name} is missing server_url`);
    }

    await pool.query(
      `
        INSERT INTO cap_capabilities (
          id, connector_id, name, description, capability_type, input_schema, output_schema,
          scopes, risk_level, status, metadata, provider_id, display_name, source,
          invocation_type, invocation_config, policy_config, connection_required
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, '{}'::jsonb, $7::jsonb, $8, 'active', '{}'::jsonb,
          $9, $10, 'mcp_import', 'mcp', $11::jsonb, $12::jsonb, $13
        )
        ON CONFLICT (name) DO UPDATE SET
          description = EXCLUDED.description,
          capability_type = EXCLUDED.capability_type,
          risk_level = EXCLUDED.risk_level,
          invocation_config = EXCLUDED.invocation_config,
          policy_config = EXCLUDED.policy_config,
          input_schema = EXCLUDED.input_schema,
          provider_id = EXCLUDED.provider_id,
          connection_required = EXCLUDED.connection_required,
          updated_at = NOW()
      `,
      [
        randomUUID(),
        activation.connectorId,
        name,
        String(candidate.description ?? ""),
        String(candidate.capability_type ?? "ACTION"),
        JSON.stringify(candidate.input_schema ?? { type: "object" }),
        JSON.stringify(candidate.required_scopes ?? []),
        String(candidate.risk_level ?? "MEDIUM"),
        activation.providerId,
        String(candidate.display_name ?? name),
        JSON.stringify(candidate.invocation_config ?? {}),
        JSON.stringify(candidate.policy_config ?? {}),
        activation.connectionRequired,
      ],
    );
    activated += 1;
  }

  if (activated > 0) {
    void emitPlatformWebhook({
      event: "import.capabilities.activated",
      payload: {
        job_id: input.jobId,
        import_type: "mcp",
        activated,
        candidate_names: input.candidateNames,
        provider_id: activation.providerId,
      },
    });
  }

  return { activated };
}
