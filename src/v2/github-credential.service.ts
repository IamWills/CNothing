import config from "../config";
import { decryptWithAes256Gcm } from "../crypto/master-key";
import {
  findConnectorByProvider,
  findUserCredential,
  upsertUserCredential,
} from "./v2.repository";

const PLATFORM_CONNECTOR_PROVIDER = "platform";

export const GITHUB_OAUTH_SCOPES = "read:user user:email repo";

export type GitHubCredentialPayload = {
  type: "github_oauth";
  access_token: string;
  scope?: string | null;
  token_type?: string | null;
};

function decodeCredentialSecret(payload: Buffer): GitHubCredentialPayload | null {
  try {
    const parsed = JSON.parse(payload.toString("utf8")) as GitHubCredentialPayload;
    if (parsed?.type !== "github_oauth" || !parsed.access_token?.trim()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function storeGitHubOAuthCredential(input: {
  userId: string;
  accessToken: string;
  scope?: string | null;
  tokenType?: string | null;
}): Promise<string> {
  const connector = await findConnectorByProvider(PLATFORM_CONNECTOR_PROVIDER);
  if (!connector) {
    throw new Error("Platform connector is not bootstrapped");
  }

  const secret = Buffer.from(
    JSON.stringify({
      type: "github_oauth",
      access_token: input.accessToken,
      scope: input.scope ?? null,
      token_type: input.tokenType ?? "bearer",
    } satisfies GitHubCredentialPayload),
    "utf8",
  );

  return upsertUserCredential({
    connector_id: connector.id,
    owner_user_id: input.userId,
    secret,
    metadata: {
      provider: "github",
      scope: input.scope ?? GITHUB_OAUTH_SCOPES,
      linked_at: new Date().toISOString(),
    },
  });
}

export async function resolveGitHubAccessToken(userId: string): Promise<string | null> {
  const connector = await findConnectorByProvider(PLATFORM_CONNECTOR_PROVIDER);

  if (connector) {
    const encrypted = await findUserCredential({
      connector_id: connector.id,
      owner_user_id: userId,
    });
    if (encrypted) {
      const iv = encrypted.encrypted_secret.subarray(0, 12);
      const tag = encrypted.encrypted_secret.subarray(12, 28);
      const ciphertext = encrypted.encrypted_secret.subarray(28);
      const plaintext = decryptWithAes256Gcm({
        ciphertext,
        iv,
        tag,
        key: config.masterKey,
      });
      const credential = decodeCredentialSecret(plaintext);
      if (credential?.access_token) {
        return credential.access_token;
      }
    }
  }

  if (userId.startsWith("github:")) {
    return null;
  }

  if (userId === "platform" || !userId) {
    return config.githubToken ?? null;
  }

  return config.githubToken ?? null;
}

export function githubCredentialRequiredMessage(userId: string): string {
  if (userId.startsWith("github:")) {
    return `GitHub account not linked for ${userId}. Sign in with GitHub at ${config.consoleUrl ?? "the Console"}/login first.`;
  }
  return `No GitHub credential for user ${userId}. Pass user_id=github:<login> after the user signs in with GitHub.`;
}

export function isGitHubCapabilityEnabled(): boolean {
  return Boolean(config.githubOAuth || config.githubToken);
}
