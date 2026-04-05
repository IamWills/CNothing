import type { HybridEnvelope } from "../crypto/hybrid-envelope";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export type JsonObject = { [key: string]: JsonValue };

export type AuthaiPublicKey = {
  algorithm: string;
  key_id: string;
  public_key_pem: string;
  public_key_fingerprint: string;
};

export type ChallengePayload = {
  v: "ksp1";
  type: "challenge";
  purpose: "authai.operation";
  client_uuid: string;
  challenge_id: string;
  nonce: string;
  issued_at: string;
  expires_at: string;
};

export type AuthEnvelopePayload = {
  v: "ksp1";
  type: "auth";
  action: "authai.refresh" | "kv.save" | "kv.read";
  client_uuid: string;
  challenge_id: string;
  nonce: string;
  issued_at: string;
  expires_at: string;
  request_id: string;
};

export type SaveEnvelopePayload = {
  v: "ksp1";
  type: "kv.save";
  namespace: string;
  items: Array<{
    key: string;
    value: JsonValue;
    metadata?: JsonObject;
  }>;
};

export type ReadEnvelopePayload = {
  v: "ksp1";
  type: "kv.read";
  namespace: string;
  keys: string[];
};

export type ReadResultPayload = {
  v: "ksp1";
  type: "kv.read.result";
  namespace: string;
  items: Record<string, JsonValue>;
};

export type RegisterClientResponse = {
  ok: true;
  client_uuid: string;
  client_key_fingerprint: string;
  authai_public_key: AuthaiPublicKey;
  challenge_for_client: HybridEnvelope;
  challenge_id: string;
  challenge_expires_at: string;
};

export type RefreshChallengeResponse = {
  ok: true;
  client_uuid: string;
  request_id: string;
  authai_public_key: AuthaiPublicKey;
  next_challenge_for_client: HybridEnvelope;
  next_challenge_id: string;
  next_challenge_expires_at: string;
};

export type SaveKvResponse = {
  ok: true;
  client_uuid: string;
  request_id: string;
  namespace: string;
  saved_keys: string[];
  authai_public_key: AuthaiPublicKey;
  next_challenge_for_client: HybridEnvelope;
  next_challenge_id: string;
  next_challenge_expires_at: string;
};

export type ReadKvResponse = {
  ok: true;
  client_uuid: string;
  request_id: string;
  namespace: string;
  returned_keys: string[];
  result_envelope_for_client: HybridEnvelope;
  authai_public_key: AuthaiPublicKey;
  next_challenge_for_client: HybridEnvelope;
  next_challenge_id: string;
  next_challenge_expires_at: string;
};

export type CNothingClientConfig = {
  baseUrl?: string;
  clientPrivateKeyPem: string;
  clientPublicKeyPem?: string;
  clientKeyId?: string;
  clientLabel?: string;
  metadata?: JsonObject;
  fetch?: typeof fetch;
};

export type CNothingSession = {
  clientUuid: string;
  challenge: ChallengePayload;
  authaiPublicKey: AuthaiPublicKey;
};
