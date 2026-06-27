import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";

export interface AppConfig {
  port: number;
  databaseUrl: string;
  serviceName: string;
  protocolVersion: string;
  consoleUrl?: string;
  publicBaseUrl: string;
  masterKey: Buffer;
  authaiPrivateKeyPath: string;
  authaiPublicKeyPath?: string;
  authaiPrivateKeyPem: string;
  authaiPublicKeyPem: string;
  authaiKeyId: string;
  challengeTtlSeconds: number;
  bearerToken?: string;
  userSessionTtlSeconds: number;
  userLoginTokenTtlSeconds: number;
  v1SunsetDate: string;
  v2AutoBootstrap: boolean;
  githubOAuth?: {
    clientId: string;
    clientSecret: string;
  };
  githubToken?: string;
  webhookDefaultUrl?: string;
  platformAgentName: string;
  autoGrantLowRiskCapabilities: boolean;
  searchApiBaseUrl?: string;
  searchAutoBootstrap: boolean;
  e2eInternalEnabled: boolean;
  githubApiBaseUrl: string;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set. Please configure it in .env or process environment.`);
  }
  return value;
}

function readRequiredAny(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`One of ${names.join(", ")} must be set.`);
}

function resolveFilePath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

function readRequiredFile(inputPath: string, label: string): string {
  const resolved = resolveFilePath(inputPath);
  try {
    return readFileSync(resolved, "utf8").trim();
  } catch (error) {
    throw new Error(
      `${label} could not be read from ${resolved}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function decodeBase64Flexible(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

const masterKey = (() => {
  const decoded = decodeBase64Flexible(readRequiredEnv("KEYSERVICE_MASTER_KEY"));
  if (decoded.length !== 32) {
    throw new Error("KEYSERVICE_MASTER_KEY must decode to exactly 32 bytes.");
  }
  return decoded;
})();

const authaiPrivateKeyPath = readRequiredAny([
  "KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH",
  "KEYSERVICE_INGRESS_PRIVATE_KEY_PATH",
]);

const authaiPublicKeyPath = process.env.KEYSERVICE_AUTHAI_PUBLIC_KEY_PATH?.trim() || undefined;

const authaiPrivateKeyPem = readRequiredFile(authaiPrivateKeyPath, "KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH");

const authaiKeyPair = (() => {
  const privateKey = createPrivateKey(authaiPrivateKeyPem);
  const derivedPublicKey = createPublicKey(privateKey);
  const derivedPublicKeyPem = derivedPublicKey.export({ type: "spki", format: "pem" }).toString();
  const publicKeyPem = authaiPublicKeyPath
    ? readRequiredFile(authaiPublicKeyPath, "KEYSERVICE_AUTHAI_PUBLIC_KEY_PATH")
    : derivedPublicKeyPem;
  const publicKey = createPublicKey(publicKeyPem);
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const keyId = createHash("sha256").update(publicKeyDer).digest("hex");
  return {
    publicKeyPem,
    keyId,
  };
})();

const challengeTtlSeconds = (() => {
  const raw = Number(process.env.KEYSERVICE_CHALLENGE_TTL_SECONDS ?? "300");
  if (!Number.isFinite(raw) || raw < 30 || raw > 3600) {
    throw new Error("KEYSERVICE_CHALLENGE_TTL_SECONDS must be a number between 30 and 3600.");
  }
  return Math.trunc(raw);
})();

const userSessionTtlSeconds = (() => {
  const raw = Number(process.env.KEYSERVICE_USER_SESSION_TTL_SECONDS ?? "86400");
  if (!Number.isFinite(raw) || raw < 300 || raw > 604800) {
    throw new Error("KEYSERVICE_USER_SESSION_TTL_SECONDS must be between 300 and 604800.");
  }
  return Math.trunc(raw);
})();

const userLoginTokenTtlSeconds = (() => {
  const raw = Number(process.env.KEYSERVICE_USER_LOGIN_TOKEN_TTL_SECONDS ?? "900");
  if (!Number.isFinite(raw) || raw < 60 || raw > 86400) {
    throw new Error("KEYSERVICE_USER_LOGIN_TOKEN_TTL_SECONDS must be between 60 and 86400.");
  }
  return Math.trunc(raw);
})();

const v1SunsetDate = (() => {
  const raw = process.env.KEYSERVICE_V1_SUNSET_DATE?.trim();
  if (raw) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("KEYSERVICE_V1_SUNSET_DATE must be a valid ISO date.");
    }
    return parsed.toISOString();
  }
  return "2026-12-17T00:00:00.000Z";
})();

const v2AutoBootstrap = process.env.KEYSERVICE_V2_AUTO_BOOTSTRAP?.trim() !== "0";

const githubOAuth = (() => {
  const clientId = process.env.KEYSERVICE_GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.KEYSERVICE_GITHUB_OAUTH_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }
  return undefined;
})();

const githubToken =
  process.env.KEYSERVICE_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || undefined;

const webhookDefaultUrl = process.env.KEYSERVICE_WEBHOOK_DEFAULT_URL?.trim() || undefined;

const autoGrantLowRiskCapabilities =
  process.env.KEYSERVICE_V2_AUTO_GRANT_LOW_RISK?.trim() !== "0";

const searchApiBaseUrl = process.env.KEYSERVICE_SEARCH_API_URL?.trim() || undefined;

const searchAutoBootstrap =
  searchApiBaseUrl !== undefined &&
  process.env.KEYSERVICE_SEARCH_AUTO_BOOTSTRAP?.trim() !== "0";

const e2eInternalEnabled = process.env.KEYSERVICE_E2E_INTERNAL?.trim() === "1";

const githubApiBaseUrl =
  process.env.KEYSERVICE_GITHUB_API_BASE_URL?.trim().replace(/\/+$/, "") ||
  "https://api.github.com";

const publicBaseUrl = (() => {
  const explicit = process.env.KEYSERVICE_PUBLIC_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const consoleUrl = process.env.KEYSERVICE_CONSOLE_URL?.trim();
  if (consoleUrl) {
    try {
      return new URL(consoleUrl).origin;
    } catch {
      // fall through
    }
  }
  const port = Number(process.env.PORT ?? "3021");
  return `http://127.0.0.1:${port}`;
})();

const config: AppConfig = {
  port: Number(process.env.PORT ?? "3021"),
  databaseUrl: readRequiredEnv("DATABASE_URL"),
  serviceName: "CNothing",
  protocolVersion: "2024-11-05",
  consoleUrl: process.env.KEYSERVICE_CONSOLE_URL?.trim() || undefined,
  publicBaseUrl,
  masterKey,
  authaiPrivateKeyPath: resolveFilePath(authaiPrivateKeyPath),
  authaiPublicKeyPath: authaiPublicKeyPath ? resolveFilePath(authaiPublicKeyPath) : undefined,
  authaiPrivateKeyPem,
  authaiPublicKeyPem: authaiKeyPair.publicKeyPem,
  authaiKeyId: authaiKeyPair.keyId,
  challengeTtlSeconds,
  bearerToken: process.env.KEYSERVICE_BEARER_TOKEN?.trim() || undefined,
  userSessionTtlSeconds,
  userLoginTokenTtlSeconds,
  v1SunsetDate,
  v2AutoBootstrap,
  githubOAuth,
  githubToken,
  webhookDefaultUrl,
  platformAgentName: process.env.KEYSERVICE_PLATFORM_AGENT_NAME?.trim() || "cnothing-platform-agent",
  autoGrantLowRiskCapabilities,
  searchApiBaseUrl,
  searchAutoBootstrap,
  e2eInternalEnabled,
  githubApiBaseUrl,
};

export default config;
