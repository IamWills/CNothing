import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";

export interface AppConfig {
  port: number;
  databaseUrl: string;
  serviceName: string;
  protocolVersion: string;
  consoleUrl?: string;
  masterKey: Buffer;
  authaiPrivateKeyPath: string;
  authaiPublicKeyPath?: string;
  authaiPrivateKeyPem: string;
  authaiPublicKeyPem: string;
  authaiKeyId: string;
  challengeTtlSeconds: number;
  bearerToken?: string;
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

const config: AppConfig = {
  port: Number(process.env.PORT ?? "3021"),
  databaseUrl: readRequiredEnv("DATABASE_URL"),
  serviceName: "CNothing",
  protocolVersion: "2024-11-05",
  consoleUrl: process.env.KEYSERVICE_CONSOLE_URL?.trim() || undefined,
  masterKey,
  authaiPrivateKeyPath: resolveFilePath(authaiPrivateKeyPath),
  authaiPublicKeyPath: authaiPublicKeyPath ? resolveFilePath(authaiPublicKeyPath) : undefined,
  authaiPrivateKeyPem,
  authaiPublicKeyPem: authaiKeyPair.publicKeyPem,
  authaiKeyId: authaiKeyPair.keyId,
  challengeTtlSeconds,
  bearerToken: process.env.KEYSERVICE_BEARER_TOKEN?.trim() || undefined,
};

export default config;
