import { readFileSync } from "node:fs";
import path from "node:path";

export interface AppConfig {
  port: number;
  databaseUrl: string;
  serviceName: string;
  consoleUrl?: string;
  publicBaseUrl: string;
  masterKey: Buffer;
  bearerToken: string;
  userSessionTtlSeconds: number;
  githubOAuth?: { clientId: string; clientSecret: string; redirectUri: string };
  apns?: { keyPem: string; keyId: string; teamId: string; bundleId: string };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/** Service/bootstrap credential. Prefer CN_SERVICE_TOKEN; KEYSERVICE_BEARER_TOKEN remains the deployment name. */
function serviceCredential(): string {
  const next = process.env.CN_SERVICE_TOKEN?.trim();
  if (next) return next;
  return required("KEYSERVICE_BEARER_TOKEN");
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return Math.trunc(value);
}

function decodeMasterKey(): Buffer {
  const raw = required("KEYSERVICE_MASTER_KEY").replace(/-/g, "+").replace(/_/g, "/");
  const padding = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
  const key = Buffer.from(`${raw}${padding}`, "base64");
  if (key.length !== 32) throw new Error("KEYSERVICE_MASTER_KEY must decode to exactly 32 bytes.");
  return key;
}

function readSecretFile(filePath: string, label: string): string {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  try {
    return readFileSync(resolved, "utf8").trim();
  } catch (error) {
    throw new Error(`${label} could not be read from ${resolved}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function configuredHttpUrl(name: string, raw: string, originOnly = false): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must use http or https.`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain embedded credentials.`);
  }
  if (originOnly && (url.pathname !== "/" || url.search || url.hash)) {
    throw new Error(`${name} must be an origin without a path, query, or fragment.`);
  }
  return (originOnly ? url.origin : url.toString()).replace(/\/+$/, "");
}

const port = boundedInteger("PORT", 3021, 1, 65535);
const consoleUrlRaw = process.env.KEYSERVICE_CONSOLE_URL?.trim();
const consoleUrl = consoleUrlRaw
  ? configuredHttpUrl("KEYSERVICE_CONSOLE_URL", consoleUrlRaw)
  : undefined;
const publicBaseUrl = (() => {
  const explicit = process.env.KEYSERVICE_PUBLIC_URL?.trim();
  if (explicit) return configuredHttpUrl("KEYSERVICE_PUBLIC_URL", explicit, true);
  if (consoleUrl) return new URL(consoleUrl).origin;
  return `http://127.0.0.1:${port}`;
})();

const githubOAuth = (() => {
  const clientId = process.env.KEYSERVICE_GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.KEYSERVICE_GITHUB_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  const explicitRedirect = process.env.KEYSERVICE_GITHUB_OAUTH_REDIRECT_URI?.trim();
  const redirectUri = explicitRedirect
    ? configuredHttpUrl("KEYSERVICE_GITHUB_OAUTH_REDIRECT_URI", explicitRedirect)
    : `${publicBaseUrl}/v4/auth/github/callback`;
  return { clientId, clientSecret, redirectUri };
})();

const apns = (() => {
  const keyPath = process.env.KEYSERVICE_APNS_KEY_PATH?.trim();
  const keyId = process.env.KEYSERVICE_APNS_KEY_ID?.trim();
  const teamId = process.env.KEYSERVICE_APNS_TEAM_ID?.trim();
  const configuredValues = [keyPath, keyId, teamId].filter(Boolean).length;
  if (configuredValues === 0) return undefined;
  if (configuredValues !== 3) {
    throw new Error(
      "APNs requires KEYSERVICE_APNS_KEY_PATH, KEYSERVICE_APNS_KEY_ID, and KEYSERVICE_APNS_TEAM_ID together.",
    );
  }
  return {
    keyPem: readSecretFile(keyPath!, "KEYSERVICE_APNS_KEY_PATH"),
    keyId: keyId!,
    teamId: teamId!,
    bundleId: process.env.KEYSERVICE_APNS_BUNDLE_ID?.trim() || "com.molobaya.app.cnothing",
  };
})();

const config: AppConfig = {
  port,
  databaseUrl: required("DATABASE_URL"),
  serviceName: "CNothing v4",
  consoleUrl,
  publicBaseUrl,
  masterKey: decodeMasterKey(),
  bearerToken: serviceCredential(),
  userSessionTtlSeconds: boundedInteger("KEYSERVICE_USER_SESSION_TTL_SECONDS", 86400, 300, 604800),
  githubOAuth,
  apns,
};

export default config;
