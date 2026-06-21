import config from "../config";
import { decryptWithAes256Gcm } from "../crypto/master-key";
import { createCNothingClient, generateClientKeyPair } from "../sdk/index";
import type { CNothingSession } from "../sdk/entity";
import type { HybridEnvelope } from "../crypto/hybrid-envelope";
import {
  enrollSearchAgent,
  fetchSearchApiPublicKey,
  isSearchIntegrationEnabled,
} from "./search-api.client";
import {
  findConnectorByProvider,
  findUserCredential,
  upsertUserCredential,
} from "./v2.repository";

export const SEARCH_CONNECTOR_PROVIDER = "search";

export type SearchCredentialPayload = {
  type: "cnothing_authai_client";
  client_uuid: string;
  client_private_key_pem: string;
  client_public_key_pem: string;
  client_key_id?: string;
  client_label?: string;
  session: CNothingSession;
  enrolled_at: string;
};

function decodeCredentialSecret(payload: Buffer): SearchCredentialPayload | null {
  try {
    const parsed = JSON.parse(payload.toString("utf8")) as SearchCredentialPayload;
    if (
      parsed?.type !== "cnothing_authai_client" ||
      !parsed.client_uuid?.trim() ||
      !parsed.client_private_key_pem?.trim() ||
      !parsed.session?.clientUuid
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function createClientFromCredential(payload: SearchCredentialPayload) {
  const client = createCNothingClient({
    baseUrl: config.publicBaseUrl,
    clientPrivateKeyPem: payload.client_private_key_pem,
    clientPublicKeyPem: payload.client_public_key_pem,
    clientKeyId: payload.client_key_id,
    clientLabel: payload.client_label,
  });
  client.setSession(payload.session);
  return client;
}

async function persistSearchCredential(input: {
  userId: string;
  payload: SearchCredentialPayload;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const connector = await findConnectorByProvider(SEARCH_CONNECTOR_PROVIDER);
  if (!connector) {
    throw new Error("Search connector is not bootstrapped");
  }

  const secret = Buffer.from(JSON.stringify(input.payload), "utf8");
  return upsertUserCredential({
    connector_id: connector.id,
    owner_user_id: input.userId,
    secret,
    metadata: {
      provider: "search",
      client_uuid: input.payload.client_uuid,
      enrolled_at: input.payload.enrolled_at,
      ...(input.metadata ?? {}),
    },
  });
}

export async function getSearchLinkStatus(userId: string): Promise<{
  linked: boolean;
  client_uuid?: string;
  enrolled_at?: string;
}> {
  const connector = await findConnectorByProvider(SEARCH_CONNECTOR_PROVIDER);
  if (!connector) {
    return { linked: false };
  }

  const encrypted = await findUserCredential({
    connector_id: connector.id,
    owner_user_id: userId,
  });
  if (!encrypted) {
    return { linked: false };
  }

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
  if (!credential) {
    return { linked: false };
  }

  return {
    linked: true,
    client_uuid: credential.client_uuid,
    enrolled_at: credential.enrolled_at,
  };
}

export async function linkSearchAccountForUser(input: {
  userId: string;
  label?: string;
}): Promise<{
  ok: true;
  client_uuid: string;
  already_linked: boolean;
  enrolled_at: string;
}> {
  if (!isSearchIntegrationEnabled()) {
    throw new Error("Search integration is not enabled. Set KEYSERVICE_SEARCH_API_URL.");
  }

  const connector = await findConnectorByProvider(SEARCH_CONNECTOR_PROVIDER);
  if (!connector) {
    throw new Error("Search connector is not bootstrapped");
  }

  const existing = await findUserCredential({
    connector_id: connector.id,
    owner_user_id: input.userId,
  });
  if (existing) {
    const iv = existing.encrypted_secret.subarray(0, 12);
    const tag = existing.encrypted_secret.subarray(12, 28);
    const ciphertext = existing.encrypted_secret.subarray(28);
    const plaintext = decryptWithAes256Gcm({
      ciphertext,
      iv,
      tag,
      key: config.masterKey,
    });
    const credential = decodeCredentialSecret(plaintext);
    if (credential) {
      return {
        ok: true,
        client_uuid: credential.client_uuid,
        already_linked: true,
        enrolled_at: credential.enrolled_at,
      };
    }
  }

  const keys = generateClientKeyPair({ keyId: `search:${input.userId}` });
  const clientLabel = input.label?.trim() || `search:${input.userId}`;
  const client = createCNothingClient({
    baseUrl: config.publicBaseUrl,
    clientPrivateKeyPem: keys.privateKeyPem,
    clientPublicKeyPem: keys.publicKeyPem,
    clientKeyId: keys.publicKeyInfo.key_id,
    clientLabel,
    metadata: {
      linked_user: input.userId,
      provider: "search",
    },
  });

  await client.register({ clientLabel });
  const { clientUuid, authEnvelope } = client.buildAuthEnvelopeForAction("authai.refresh");
  const searchPublicKey = await fetchSearchApiPublicKey();

  await enrollSearchAgent({
    client_uuid: clientUuid,
    auth_envelope: authEnvelope,
    reader_public_key: searchPublicKey.public_key_pem,
    label: clientLabel,
  });

  await client.refresh();

  const enrolledAt = new Date().toISOString();
  const session = client.getSession();
  if (!session) {
    throw new Error("Failed to persist Search credential session");
  }

  const payload: SearchCredentialPayload = {
    type: "cnothing_authai_client",
    client_uuid: session.clientUuid,
    client_private_key_pem: keys.privateKeyPem,
    client_public_key_pem: keys.publicKeyPem,
    client_key_id: keys.publicKeyInfo.key_id,
    client_label: clientLabel,
    session,
    enrolled_at: enrolledAt,
  };

  await persistSearchCredential({
    userId: input.userId,
    payload,
    metadata: { linked_at: enrolledAt },
  });

  return {
    ok: true,
    client_uuid: payload.client_uuid,
    already_linked: false,
    enrolled_at: enrolledAt,
  };
}

export async function resolveSearchAuthContext(userId: string): Promise<{
  clientUuid: string;
  authEnvelope: HybridEnvelope;
}> {
  const connector = await findConnectorByProvider(SEARCH_CONNECTOR_PROVIDER);
  if (!connector) {
    throw new Error("Search connector is not bootstrapped");
  }

  const encrypted = await findUserCredential({
    connector_id: connector.id,
    owner_user_id: userId,
  });
  if (!encrypted) {
    throw new Error(searchCredentialRequiredMessage(userId));
  }

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
  if (!credential) {
    throw new Error(searchCredentialRequiredMessage(userId));
  }

  const client = createClientFromCredential(credential);
  await client.refresh();

  const session = client.getSession();
  if (!session) {
    throw new Error("Search credential session is invalid");
  }

  await persistSearchCredential({
    userId,
    payload: {
      ...credential,
      client_uuid: session.clientUuid,
      session,
    },
  });

  return client.buildAuthEnvelopeForAction("authai.refresh");
}

export function searchCredentialRequiredMessage(userId: string): string {
  const consoleUrl = config.consoleUrl ?? config.publicBaseUrl;
  return `Search account not linked for ${userId}. Link at ${consoleUrl}/login (sign in) then POST /v2/auth/search/link with your user session.`;
}
