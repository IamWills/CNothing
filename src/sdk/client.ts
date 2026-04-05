import { randomUUID } from "node:crypto";
import {
  buildAuthEnvelope,
  buildReadEnvelope,
  buildSaveEnvelope,
  decryptChallengeForClient,
  decryptReadResultForClient,
  derivePublicKeyPem,
  isClientSealedValue,
  normalizePrivacyKey,
  protectNamespace,
  protectRecordKey,
  sealValueForClient,
  unsealValueForClient,
} from "./crypto";
import type {
  AuthEnvelopePayload,
  AuthaiPublicKey,
  ClientSealedValue,
  CNothingClientConfig,
  CNothingSession,
  JsonObject,
  JsonValue,
  ReadEnvelopePayload,
  ReadKvResponse,
  ReadResultPayload,
  RefreshChallengeResponse,
  RegisterClientResponse,
  RotateKeyResponse,
  SaveEnvelopePayload,
  SaveKvResponse,
} from "./entity";

const DEFAULT_BASE_URL = "https://cnothing.com";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const errorMessage =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? "Request failed")
        : `Request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return data as T;
}

export class CNothingClient {
  private readonly baseUrl: string;
  private clientPrivateKeyPem: string;
  private clientPublicKeyPem: string;
  private clientKeyId?: string;
  private clientLabel?: string;
  private metadata?: JsonObject;
  private readonly privacyKey?: Buffer;
  private readonly fetchImpl: typeof fetch;

  private session: CNothingSession | null = null;

  constructor(config: CNothingClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.clientPrivateKeyPem = config.clientPrivateKeyPem;
    this.clientPublicKeyPem =
      config.clientPublicKeyPem ?? derivePublicKeyPem(config.clientPrivateKeyPem);
    this.clientKeyId = config.clientKeyId;
    this.clientLabel = config.clientLabel;
    this.metadata = config.metadata;
    this.privacyKey = config.privacyKey ? normalizePrivacyKey(config.privacyKey) : undefined;
    this.fetchImpl = config.fetch ?? fetch;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getSession(): CNothingSession | null {
    return this.session;
  }

  setSession(session: CNothingSession | null): void {
    this.session = session;
  }

  async getAuthaiPublicKey(): Promise<AuthaiPublicKey> {
    const response = await requestJson<{ ok: true; authai_public_key: AuthaiPublicKey }>(
      this.fetchImpl,
      this.baseUrl,
      "/v1/authai/public-key",
    );
    return response.authai_public_key;
  }

  async register(input?: {
    clientKeyId?: string;
    clientLabel?: string;
    metadata?: JsonObject;
  }): Promise<CNothingSession> {
    const response = await requestJson<RegisterClientResponse>(
      this.fetchImpl,
      this.baseUrl,
      "/v1/authai/register",
      {
        method: "POST",
        body: JSON.stringify({
          client_public_key: this.clientPublicKeyPem,
          client_key_id: input?.clientKeyId ?? this.clientKeyId,
          client_label: input?.clientLabel ?? this.clientLabel,
          metadata: input?.metadata ?? this.metadata,
        }),
      },
    );

    const challenge = decryptChallengeForClient({
      clientPrivateKeyPem: this.clientPrivateKeyPem,
      envelope: response.challenge_for_client,
      expectedKeyId: input?.clientKeyId ?? this.clientKeyId,
    });

    const session = {
      clientUuid: response.client_uuid,
      challenge,
      authaiPublicKey: response.authai_public_key,
    };
    this.session = session;
    return session;
  }

  async refresh(): Promise<CNothingSession> {
    const session = this.requireSession();
    const authPayload = this.buildAuthPayload(session, "authai.refresh");
    const response = await requestJson<RefreshChallengeResponse>(
      this.fetchImpl,
      this.baseUrl,
      "/v1/authai/refresh",
      {
        method: "POST",
        body: JSON.stringify({
          auth_envelope: buildAuthEnvelope({
            authaiPublicKey: session.authaiPublicKey,
            payload: authPayload,
          }),
        }),
      },
    );

    this.session = this.advanceSession({
      clientUuid: response.client_uuid,
      authaiPublicKey: response.authai_public_key,
      nextChallengeEnvelope: response.next_challenge_for_client,
    });
    return this.session;
  }

  async rotateKey(input: {
    newClientPrivateKeyPem: string;
    newClientPublicKeyPem?: string;
    newClientKeyId?: string;
    newClientLabel?: string;
    metadata?: JsonObject;
  }): Promise<CNothingSession & { rotation: RotateKeyResponse }> {
    const session = this.requireSession();
    const nextPublicKeyPem =
      input.newClientPublicKeyPem ?? derivePublicKeyPem(input.newClientPrivateKeyPem);
    const authPayload = this.buildAuthPayload(session, "authai.rotate_key");

    const response = await requestJson<RotateKeyResponse>(
      this.fetchImpl,
      this.baseUrl,
      "/v1/authai/rotate-key",
      {
        method: "POST",
        body: JSON.stringify({
          auth_envelope: buildAuthEnvelope({
            authaiPublicKey: session.authaiPublicKey,
            payload: authPayload,
          }),
          new_client_public_key: nextPublicKeyPem,
          new_client_key_id: input.newClientKeyId,
          new_client_label: input.newClientLabel ?? this.clientLabel,
          metadata: input.metadata ?? this.metadata,
        }),
      },
    );

    this.clientPrivateKeyPem = input.newClientPrivateKeyPem;
    this.clientPublicKeyPem = nextPublicKeyPem;
    this.clientKeyId = input.newClientKeyId;
    this.clientLabel = input.newClientLabel ?? this.clientLabel;
    this.metadata = input.metadata ?? this.metadata;

    this.session = this.advanceSession({
      clientUuid: response.client_uuid,
      authaiPublicKey: response.authai_public_key,
      nextChallengeEnvelope: response.next_challenge_for_client,
    });

    return {
      ...this.session,
      rotation: response,
    };
  }

  async saveJson(input: {
    namespace: string;
    items: Array<{ key: string; value: JsonValue; metadata?: JsonObject }>;
  }): Promise<SaveKvResponse & { session: CNothingSession }> {
    const session = this.requireSession();
    const authPayload = this.buildAuthPayload(session, "kv.save");
    const dataPayload: SaveEnvelopePayload = {
      v: "ksp1",
      type: "kv.save",
      namespace: input.namespace,
      items: input.items,
    };

    const response = await requestJson<SaveKvResponse>(
      this.fetchImpl,
      this.baseUrl,
      "/v1/kv/save",
      {
        method: "POST",
        body: JSON.stringify({
          auth_envelope: buildAuthEnvelope({
            authaiPublicKey: session.authaiPublicKey,
            payload: authPayload,
          }),
          data_envelope: buildSaveEnvelope({
            authaiPublicKey: session.authaiPublicKey,
            payload: dataPayload,
          }),
        }),
      },
    );

    this.session = this.advanceSession({
      clientUuid: response.client_uuid,
      authaiPublicKey: response.authai_public_key,
      nextChallengeEnvelope: response.next_challenge_for_client,
    });

    return {
      ...response,
      session: this.session,
    };
  }

  async readJson(input: {
    namespace: string;
    keys: string[];
  }): Promise<
    ReadKvResponse & {
      session: CNothingSession;
      result: ReadResultPayload;
    }
  > {
    const session = this.requireSession();
    const authPayload = this.buildAuthPayload(session, "kv.read");
    const queryPayload: ReadEnvelopePayload = {
      v: "ksp1",
      type: "kv.read",
      namespace: input.namespace,
      keys: input.keys,
    };

    const response = await requestJson<ReadKvResponse>(
      this.fetchImpl,
      this.baseUrl,
      "/v1/kv/read",
      {
        method: "POST",
        body: JSON.stringify({
          auth_envelope: buildAuthEnvelope({
            authaiPublicKey: session.authaiPublicKey,
            payload: authPayload,
          }),
          query_envelope: buildReadEnvelope({
            authaiPublicKey: session.authaiPublicKey,
            payload: queryPayload,
          }),
        }),
      },
    );

    const result = decryptReadResultForClient({
      clientPrivateKeyPem: this.clientPrivateKeyPem,
      envelope: response.result_envelope_for_client,
      expectedKeyId: this.clientKeyId,
    });

    this.session = this.advanceSession({
      clientUuid: response.client_uuid,
      authaiPublicKey: response.authai_public_key,
      nextChallengeEnvelope: response.next_challenge_for_client,
    });

    return {
      ...response,
      result,
      session: this.session,
    };
  }

  async savePrivateJson(input: {
    namespace: string;
    items: Array<{ key: string; value: JsonValue; metadata?: JsonObject }>;
  }): Promise<SaveKvResponse & { session: CNothingSession }> {
    return this.saveJson({
      namespace: input.namespace,
      items: input.items.map((item) => ({
        key: item.key,
        metadata: item.metadata,
        value: sealValueForClient({
          clientPublicKeyPem: this.clientPublicKeyPem,
          keyId: this.clientKeyId,
          value: item.value,
        }),
      })),
    });
  }

  async readPrivateJson(input: {
    namespace: string;
    keys: string[];
  }): Promise<
    ReadKvResponse & {
      session: CNothingSession;
      sealedResult: ReadResultPayload;
      items: Record<string, JsonValue>;
    }
  > {
    const response = await this.readJson(input);
    const items = Object.fromEntries(
      Object.entries(response.result.items).map(([key, value]) => {
        if (!isClientSealedValue(value)) {
          throw new Error(
            `Key ${key} is not stored as a client-sealed value. Use readJson() for plain protocol values.`,
          );
        }
        return [
          key,
          unsealValueForClient({
            clientPrivateKeyPem: this.clientPrivateKeyPem,
            sealedValue: value,
            expectedKeyId: this.clientKeyId,
          }),
        ];
      }),
    );

    return {
      ...response,
      sealedResult: response.result,
      items,
    };
  }

  async saveBlindJson(input: {
    namespace: string;
    items: Array<{ key: string; value: JsonValue; metadata?: JsonObject }>;
  }): Promise<
    SaveKvResponse & {
      session: CNothingSession;
      protectedNamespace: string;
      protectedKeys: Record<string, string>;
    }
  > {
    const privacyKey = this.requirePrivacyKey();
    const protectedNamespace = protectNamespace({
      privacyKey,
      namespace: input.namespace,
    });
    const protectedKeys = Object.fromEntries(
      input.items.map((item) => [
        item.key,
        protectRecordKey({
          privacyKey,
          namespace: input.namespace,
          key: item.key,
        }),
      ]),
    );

    const response = await this.saveJson({
      namespace: protectedNamespace,
      items: input.items.map((item) => ({
        key: protectedKeys[item.key]!,
        value: sealValueForClient({
          clientPublicKeyPem: this.clientPublicKeyPem,
          keyId: this.clientKeyId,
          value: item.value,
        }),
        metadata: item.metadata
          ? ({
              sealed_metadata: sealValueForClient({
                clientPublicKeyPem: this.clientPublicKeyPem,
                keyId: this.clientKeyId,
                value: item.metadata,
              }),
            } as JsonObject)
          : undefined,
      })),
    });

    return {
      ...response,
      protectedNamespace,
      protectedKeys,
    };
  }

  async readBlindJson(input: {
    namespace: string;
    keys: string[];
  }): Promise<
    ReadKvResponse & {
      session: CNothingSession;
      sealedResult: ReadResultPayload;
      items: Record<string, JsonValue>;
      protectedNamespace: string;
      protectedKeys: Record<string, string>;
    }
  > {
    const privacyKey = this.requirePrivacyKey();
    const protectedNamespace = protectNamespace({
      privacyKey,
      namespace: input.namespace,
    });
    const protectedKeys = Object.fromEntries(
      input.keys.map((key) => [
        key,
        protectRecordKey({
          privacyKey,
          namespace: input.namespace,
          key,
        }),
      ]),
    );

    const response = await this.readJson({
      namespace: protectedNamespace,
      keys: Object.values(protectedKeys),
    });

    const reverseKeys = new Map(
      Object.entries(protectedKeys).map(([plainKey, protectedKey]) => [protectedKey, plainKey]),
    );

    const items = Object.fromEntries(
      Object.entries(response.result.items).map(([protectedKey, value]) => {
        const plainKey = reverseKeys.get(protectedKey);
        if (!plainKey) {
          throw new Error(`Received unexpected protected key ${protectedKey}`);
        }
        if (!isClientSealedValue(value)) {
          throw new Error(
            `Key ${plainKey} is not stored as a client-sealed value. Use readJson() for plain protocol values.`,
          );
        }
        return [
          plainKey,
          unsealValueForClient({
            clientPrivateKeyPem: this.clientPrivateKeyPem,
            sealedValue: value,
            expectedKeyId: this.clientKeyId,
          }),
        ];
      }),
    );

    return {
      ...response,
      sealedResult: response.result,
      items,
      protectedNamespace,
      protectedKeys,
    };
  }

  private buildAuthPayload(
    session: CNothingSession,
    action: AuthEnvelopePayload["action"],
  ): AuthEnvelopePayload {
    return {
      v: "ksp1",
      type: "auth",
      action,
      client_uuid: session.clientUuid,
      challenge_id: session.challenge.challenge_id,
      nonce: session.challenge.nonce,
      issued_at: session.challenge.issued_at,
      expires_at: session.challenge.expires_at,
      request_id: randomUUID(),
    };
  }

  private advanceSession(input: {
    clientUuid: string;
    authaiPublicKey: AuthaiPublicKey;
    nextChallengeEnvelope: ReadKvResponse["next_challenge_for_client"];
  }): CNothingSession {
    const challenge = decryptChallengeForClient({
      clientPrivateKeyPem: this.clientPrivateKeyPem,
      envelope: input.nextChallengeEnvelope,
      expectedKeyId: this.clientKeyId,
    });

    return {
      clientUuid: input.clientUuid,
      challenge,
      authaiPublicKey: input.authaiPublicKey,
    };
  }

  private requireSession(): CNothingSession {
    if (!this.session) {
      throw new Error(
        "CNothing session is not initialized. Call register() first or restore a saved session.",
      );
    }
    return this.session;
  }

  private requirePrivacyKey(): Buffer {
    if (!this.privacyKey) {
      throw new Error(
        "CNothing privacyKey is not configured. Provide privacyKey in the client config to protect namespace, key, and metadata.",
      );
    }
    return this.privacyKey;
  }
}

export function createCNothingClient(config: CNothingClientConfig): CNothingClient {
  return new CNothingClient(config);
}
